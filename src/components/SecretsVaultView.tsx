import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  KeyRound,
  Plus,
  Search,
  Eye,
  EyeOff,
  Copy,
  Check,
  RefreshCw,
  Trash2,
  Edit,
  AlertTriangle,
  Clock,
  Download,
  Upload,
  Link2,
  ShieldCheck,
  ExternalLink,
  History,
  Terminal,
  Lock,
  Sparkles,
  FileSpreadsheet,
  FileJson,
} from 'lucide-react';
import {
  SecretAuditAction,
  SecretAuditLogEntry,
  SecretEnvironment,
  SecretItem,
  SecretStatus,
  SecretType,
  TrackerApiTokenRecord,
} from '../types/secret';
import {
  DEFAULT_SAAS_PRODUCTS,
  DEFAULT_SAAS_SERVICES,
  DEMO_SECRET_IDS,
  SECRET_TYPE_LABELS,
  computeNextRotationDue,
  evaluateSecretUrgency,
  exportSecretsMetadataToCsv,
  exportSecretsMetadataToJson,
  parseSecretsMetadataCsv,
} from '../utils/secretHelpers';
import { decryptSecretString, encryptSecretString } from '../utils/crypto';
import { BottomSheet } from './BottomSheet';
import {
  fetchTrackerTokensDirect,
  createTrackerTokenDirect,
  revokeTrackerTokenDirect,
} from '../firebase';

interface SecretsVaultViewProps {
  secrets: SecretItem[];
  onUpdateSecrets: (newSecrets: SecretItem[]) => void;
  auditLogs: SecretAuditLogEntry[];
  onLogAudit: (action: SecretAuditAction, targetLabel: string, targetId?: string, details?: string) => void;
  masterKey: CryptoKey | null;
  lastVerifiedAt: number;
  onVerifyStepUp: (passphrase: string) => Promise<boolean>;
  highlightedSecretId?: string | null;
  onClearHighlightedSecret?: () => void;
  onLoadDemoSecrets: () => void;
  showToast: (msg: string) => void;
}

export const SecretsVaultView: React.FC<SecretsVaultViewProps> = ({
  secrets,
  onUpdateSecrets,
  auditLogs,
  onLogAudit,
  masterKey,
  lastVerifiedAt,
  onVerifyStepUp,
  highlightedSecretId,
  onClearHighlightedSecret,
  onLoadDemoSecrets,
  showToast,
}) => {
  // Module sub-view: 'items' | 'tracker_api' | 'audit_log'
  const [subTab, setSubTab] = useState<'items' | 'tracker_api' | 'audit_log'>('items');

  // Search & Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [filterProduct, setFilterProduct] = useState<string>('all');
  const [filterService, setFilterService] = useState<string>('all');
  const [filterEnv, setFilterEnv] = useState<string>('all');
  const [filterType, setFilterType] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [dueFilter, setDueFilter] = useState<'all' | 'overdue' | 'due_7' | 'due_14' | 'due_custom'>('all');
  const [customWindowDays, setCustomWindowDays] = useState<number>(30);

  // Revealed secret state (auto-hides after 15s)
  const [revealedItemId, setRevealedItemId] = useState<string | null>(null);
  const [revealedPlaintext, setRevealedPlaintext] = useState<string>('');
  const [revealedNotes, setRevealedNotes] = useState<string>('');
  const [revealCountdown, setRevealCountdown] = useState<number | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Step-Up Auth Modal State (required if > 60s since unlock/verify)
  const [stepUpModal, setStepUpModal] = useState<{
    isOpen: boolean;
    item: SecretItem | null;
    intent: 'reveal' | 'copy' | 'inspect';
  }>({ isOpen: false, item: null, intent: 'reveal' });
  const [stepUpPassphrase, setStepUpPassphrase] = useState('');
  const [stepUpError, setStepUpError] = useState<string | null>(null);
  const [isVerifyingStepUp, setIsVerifyingStepUp] = useState(false);

  // Add / Edit Secret Modal State
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<SecretItem | null>(null);
  const [formId, setFormId] = useState('');
  const [formLabel, setFormLabel] = useState('');
  const [formProduct, setFormProduct] = useState('Shared / all products');
  const [formService, setFormService] = useState('');
  const [formType, setFormType] = useState<SecretType>('api_key');
  const [formEnv, setFormEnv] = useState<SecretEnvironment>('production');
  const [formSecretValue, setFormSecretValue] = useState('');
  const [formShowSecret, setFormShowSecret] = useState(false);
  const [formLoginUrl, setFormLoginUrl] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formUsername, setFormUsername] = useState('');
  const [formCreatedDate, setFormCreatedDate] = useState('');
  const [formLastRotatedDate, setFormLastRotatedDate] = useState('');
  const [formIntervalDays, setFormIntervalDays] = useState<number>(90);
  const [formExpiryDate, setFormExpiryDate] = useState('');
  const [formStatus, setFormStatus] = useState<SecretStatus>('active');
  const [formNotes, setFormNotes] = useState('');
  const [formTags, setFormTags] = useState('');

  // Rotate Secret Modal State
  const [rotatingItem, setRotatingItem] = useState<SecretItem | null>(null);
  const [rotateNewSecret, setRotateNewSecret] = useState('');
  const [rotateNote, setRotateNote] = useState('');
  const [rotateIntervalDays, setRotateIntervalDays] = useState<number>(90);

  // Inspect / History Sheet State
  const [inspectingItem, setInspectingItem] = useState<SecretItem | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // SaaS Tracker Read-Only API Tokens State
  const [trackerTokens, setTrackerTokens] = useState<TrackerApiTokenRecord[]>([]);
  const [newTokenLabel, setNewTokenLabel] = useState('');
  const [newlyGeneratedRawToken, setNewlyGeneratedRawToken] = useState<string | null>(null);
  const csvInputRef = useRef<HTMLInputElement | null>(null);

  // Demo Mode visibility preference (allows turning off Demo API keys button)
  const [demoModeOff, setDemoModeOff] = useState<boolean>(() => {
    try {
      return localStorage.getItem('krypton_vault_demo_off_v1') === 'true';
    } catch {
      return false;
    }
  });

  const demoSecretsInVault = useMemo(
    () => secrets.filter((s) => DEMO_SECRET_IDS.includes(s.id)),
    [secrets]
  );

  const handleToggleDemoMode = (off: boolean) => {
    setDemoModeOff(off);
    try {
      localStorage.setItem('krypton_vault_demo_off_v1', off ? 'true' : 'false');
    } catch {}
    if (off && demoSecretsInVault.length > 0) {
      const remaining = secrets.filter((s) => !DEMO_SECRET_IDS.includes(s.id));
      onUpdateSecrets(remaining);
      onLogAudit('delete', 'Demo SaaS API Keys Bundle', undefined, `Removed ${demoSecretsInVault.length} sample secrets & turned off demo mode`);
      showToast(`Deleted ${demoSecretsInVault.length} demo API keys and turned off Demo Mode.`);
    } else if (off) {
      showToast('Demo Mode turned off.');
    } else {
      showToast('Demo Mode re-enabled.');
    }
  };

  const handleDeleteAllDemoSecrets = () => {
    if (demoSecretsInVault.length === 0) return;
    const remaining = secrets.filter((s) => !DEMO_SECRET_IDS.includes(s.id));
    onUpdateSecrets(remaining);
    onLogAudit('delete', 'Demo SaaS API Keys Bundle', undefined, `Deleted ${demoSecretsInVault.length} sample secrets`);
    showToast(`Deleted all ${demoSecretsInVault.length} demo API keys.`);
  };

  // Handle deep-link highlighting (/vault/api-keys/<id>)
  useEffect(() => {
    if (highlightedSecretId && secrets.length > 0) {
      const found = secrets.find((s) => s.id === highlightedSecretId);
      if (found) {
        setInspectingItem(found);
      }
    }
  }, [highlightedSecretId, secrets]);

  // Auto-hide revealed secret after 15 seconds
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (revealedItemId) {
      setRevealCountdown(15);
      timer = setInterval(() => {
        setRevealCountdown((prev) => {
          if (prev === null || prev <= 1) {
            setRevealedItemId(null);
            setRevealedPlaintext('');
            setRevealedNotes('');
            clearInterval(timer);
            return null;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      setRevealCountdown(null);
    }
    return () => clearInterval(timer);
  }, [revealedItemId]);

  // Fetch SaaS Tracker read-only tokens directly from Firebase Firestore when opening the Tracker API sub-tab
  useEffect(() => {
    if (subTab === 'tracker_api') {
      fetchTrackerTokensDirect()
        .then((tokens) => {
          setTrackerTokens(tokens);
        })
        .catch(() => {});
    }
  }, [subTab]);

  // Unique Products & Services for Autocomplete and Filtering
  const productOptions = useMemo(() => {
    const set = new Set<string>(DEFAULT_SAAS_PRODUCTS);
    secrets.forEach((s) => {
      if (s.product_name) set.add(s.product_name);
    });
    return Array.from(set);
  }, [secrets]);

  const serviceOptions = useMemo(() => {
    const set = new Set<string>(DEFAULT_SAAS_SERVICES);
    secrets.forEach((s) => {
      if (s.service_name) set.add(s.service_name);
    });
    return Array.from(set);
  }, [secrets]);

  // Urgency & Due-Soon Counts
  const urgencyMap = useMemo(() => {
    const map: Record<string, ReturnType<typeof evaluateSecretUrgency>> = {};
    secrets.forEach((s) => {
      map[s.id] = evaluateSecretUrgency(s, customWindowDays);
    });
    return map;
  }, [secrets, customWindowDays]);

  const dueCounts = useMemo(() => {
    let overdue = 0;
    let due7 = 0;
    let due14 = 0;
    let dueCustom = 0;
    secrets.forEach((s) => {
      if (s.status === 'revoked') return;
      const u = urgencyMap[s.id];
      if (!u) return;
      if (u.bucket === 'overdue') overdue++;
      if (u.bucket === 'due_7' || u.bucket === 'overdue') due7++;
      if (u.bucket === 'due_14' || u.bucket === 'due_7' || u.bucket === 'overdue') due14++;
      if (
        u.bucket === 'due_custom' ||
        u.bucket === 'due_14' ||
        u.bucket === 'due_7' ||
        u.bucket === 'overdue'
      ) {
        dueCustom++;
      }
    });
    return { overdue, due7, due14, dueCustom };
  }, [secrets, urgencyMap]);

  // Filtered Secrets List
  const filteredSecrets = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return secrets.filter((item) => {
      if (filterProduct !== 'all' && item.product_name !== filterProduct) return false;
      if (filterService !== 'all' && item.service_name !== filterService) return false;
      if (filterEnv !== 'all' && item.environment !== filterEnv) return false;
      if (filterType !== 'all' && item.secret_type !== filterType) return false;
      if (filterStatus !== 'all' && item.status !== filterStatus) return false;

      if (dueFilter !== 'all') {
        if (item.status === 'revoked') return false;
        const u = urgencyMap[item.id];
        if (dueFilter === 'overdue' && u.bucket !== 'overdue') return false;
        if (dueFilter === 'due_7' && u.bucket !== 'overdue' && u.bucket !== 'due_7') return false;
        if (
          dueFilter === 'due_14' &&
          u.bucket !== 'overdue' &&
          u.bucket !== 'due_7' &&
          u.bucket !== 'due_14'
        ) {
          return false;
        }
        if (
          dueFilter === 'due_custom' &&
          u.bucket !== 'overdue' &&
          u.bucket !== 'due_7' &&
          u.bucket !== 'due_14' &&
          u.bucket !== 'due_custom'
        ) {
          return false;
        }
      }

      if (q.length > 0) {
        const matchLabel = item.label.toLowerCase().includes(q);
        const matchProd = item.product_name.toLowerCase().includes(q);
        const matchServ = item.service_name.toLowerCase().includes(q);
        const matchId = item.id.toLowerCase().includes(q);
        const matchEmail = item.account_email?.toLowerCase().includes(q) || false;
        const matchUser = item.username?.toLowerCase().includes(q) || false;
        const matchTag = (item.tags || []).some((t) => t.toLowerCase().includes(q));
        return (
          matchLabel ||
          matchProd ||
          matchServ ||
          matchId ||
          matchEmail ||
          matchUser ||
          matchTag
        );
      }

      return true;
    });
  }, [
    secrets,
    searchQuery,
    filterProduct,
    filterService,
    filterEnv,
    filterType,
    filterStatus,
    dueFilter,
    urgencyMap,
  ]);

  // Duplicate Detection inside Add/Edit Form
  const duplicateWarningItem = useMemo(() => {
    if (!formService.trim() || !formProduct.trim()) return null;
    return secrets.find(
      (s) =>
        s.id !== (editingItem?.id || '') &&
        s.status === 'active' &&
        s.product_name.trim().toLowerCase() === formProduct.trim().toLowerCase() &&
        s.service_name.trim().toLowerCase() === formService.trim().toLowerCase() &&
        s.environment === formEnv
    );
  }, [secrets, editingItem, formProduct, formService, formEnv]);

  // Check if step-up verification is fresh (within 60 seconds)
  const isStepUpFresh = () => {
    return Date.now() - lastVerifiedAt <= 60000;
  };

  const executeRevealOrCopy = async (item: SecretItem, intent: 'reveal' | 'copy' | 'inspect') => {
    if (!masterKey) return;
    try {
      const decryptedSecret = await decryptSecretString(item.secret_value_encrypted, masterKey);
      const decryptedNotes = await decryptSecretString(item.notes_encrypted, masterKey);

      if (intent === 'reveal' || intent === 'inspect') {
        setRevealedItemId(item.id);
        setRevealedPlaintext(decryptedSecret || '(No secret value set yet — use Rotate)');
        setRevealedNotes(decryptedNotes);
        onLogAudit('reveal', item.label, item.id, `${item.product_name} · ${item.environment}`);
      } else if (intent === 'copy') {
        if (!decryptedSecret) {
          showToast('No secret value stored yet. Click Rotate to set one.');
          return;
        }
        await navigator.clipboard?.writeText(decryptedSecret);
        setCopiedId(item.id);
        setTimeout(() => setCopiedId(null), 2500);
        onLogAudit('copy', item.label, item.id, `Copied (${item.environment}) — 30s clipboard wipe scheduled`);
        showToast('Secret copied! Clipboard will auto-clear in 30 seconds.');

        // Automatically clear clipboard after 30 seconds where browser allows
        setTimeout(() => {
          navigator.clipboard?.writeText('').catch(() => {});
        }, 30000);
      }
    } catch {
      showToast('Failed to decrypt secret value.');
    }
  };

  const handleTriggerProtectedAction = (item: SecretItem, intent: 'reveal' | 'copy' | 'inspect') => {
    if (intent === 'reveal' && revealedItemId === item.id) {
      setRevealedItemId(null);
      setRevealedPlaintext('');
      setRevealedNotes('');
      return;
    }

    if (isStepUpFresh()) {
      executeRevealOrCopy(item, intent);
    } else {
      setStepUpModal({ isOpen: true, item, intent });
      setStepUpPassphrase('');
      setStepUpError(null);
    }
  };

  const handleStepUpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stepUpPassphrase || !stepUpModal.item) return;
    setIsVerifyingStepUp(true);
    setStepUpError(null);
    try {
      const ok = await onVerifyStepUp(stepUpPassphrase);
      if (!ok) {
        setStepUpError('Incorrect Master Passphrase.');
        return;
      }
      const targetItem = stepUpModal.item;
      const targetIntent = stepUpModal.intent;
      setStepUpModal({ isOpen: false, item: null, intent: 'reveal' });
      setStepUpPassphrase('');
      await executeRevealOrCopy(targetItem, targetIntent);
    } finally {
      setIsVerifyingStepUp(false);
    }
  };

  // Open Add / Edit Modal
  const openCreateModal = () => {
    const todayStr = new Date().toISOString().split('T')[0];
    setEditingItem(null);
    setFormId(`sec_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`);
    setFormLabel('');
    setFormProduct('Shared / all products');
    setFormService('');
    setFormType('api_key');
    setFormEnv('production');
    setFormSecretValue('');
    setFormShowSecret(false);
    setFormLoginUrl('');
    setFormEmail('');
    setFormUsername('');
    setFormCreatedDate(todayStr);
    setFormLastRotatedDate(todayStr);
    setFormIntervalDays(90);
    setFormExpiryDate('');
    setFormStatus('active');
    setFormNotes('');
    setFormTags('');
    setIsFormOpen(true);
  };

  const openEditModal = async (item: SecretItem) => {
    setEditingItem(item);
    setFormId(item.id);
    setFormLabel(item.label);
    setFormProduct(item.product_name);
    setFormService(item.service_name);
    setFormType(item.secret_type);
    setFormEnv(item.environment);
    setFormLoginUrl(item.login_url || '');
    setFormEmail(item.account_email || '');
    setFormUsername(item.username || '');
    setFormCreatedDate(item.created_date);
    setFormLastRotatedDate(item.last_rotated_date);
    setFormIntervalDays(item.rotation_interval_days || 90);
    setFormExpiryDate(item.expiry_date || '');
    setFormStatus(item.status);
    setFormTags((item.tags || []).join(', '));
    setFormShowSecret(false);

    if (masterKey) {
      const decSecret = await decryptSecretString(item.secret_value_encrypted, masterKey);
      const decNotes = await decryptSecretString(item.notes_encrypted, masterKey);
      setFormSecretValue(decSecret);
      setFormNotes(decNotes);
    } else {
      setFormSecretValue('');
      setFormNotes('');
    }
    setIsFormOpen(true);
  };

  const handleSaveSecretForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!masterKey || !formLabel.trim() || !formService.trim()) return;

    const nowIso = new Date().toISOString();
    const next_rotation_due = computeNextRotationDue(
      formLastRotatedDate,
      formIntervalDays > 0 ? formIntervalDays : undefined
    );

    const secret_value_encrypted = formSecretValue
      ? await encryptSecretString(formSecretValue, masterKey)
      : editingItem?.secret_value_encrypted;

    const notes_encrypted = formNotes.trim()
      ? await encryptSecretString(formNotes.trim(), masterKey)
      : undefined;

    const parsedTags = formTags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    if (editingItem) {
      const updatedItem: SecretItem = {
        ...editingItem,
        label: formLabel.trim(),
        product_name: formProduct.trim() || 'Shared / all products',
        service_name: formService.trim(),
        secret_type: formType,
        environment: formEnv,
        secret_value_encrypted,
        notes_encrypted,
        login_url: formLoginUrl.trim() || undefined,
        account_email: formEmail.trim() || undefined,
        username: formUsername.trim() || undefined,
        created_date: formCreatedDate,
        last_rotated_date: formLastRotatedDate,
        rotation_interval_days: formIntervalDays > 0 ? formIntervalDays : undefined,
        next_rotation_due,
        expiry_date: formExpiryDate || undefined,
        status: formStatus,
        tags: parsedTags,
        updated_at: nowIso,
      };
      const nextList = secrets.map((s) => (s.id === editingItem.id ? updatedItem : s));
      onUpdateSecrets(nextList);
      onLogAudit('edit', updatedItem.label, updatedItem.id, `${updatedItem.product_name} (${updatedItem.environment})`);
      showToast('Secret encrypted and updated.');
    } else {
      const newItem: SecretItem = {
        id: formId.trim() || `sec_${Date.now().toString(36)}`,
        label: formLabel.trim(),
        product_name: formProduct.trim() || 'Shared / all products',
        service_name: formService.trim(),
        secret_type: formType,
        environment: formEnv,
        secret_value_encrypted,
        notes_encrypted,
        login_url: formLoginUrl.trim() || undefined,
        account_email: formEmail.trim() || undefined,
        username: formUsername.trim() || undefined,
        created_date: formCreatedDate,
        last_rotated_date: formLastRotatedDate,
        rotation_interval_days: formIntervalDays > 0 ? formIntervalDays : undefined,
        next_rotation_due,
        expiry_date: formExpiryDate || undefined,
        status: formStatus,
        tags: parsedTags,
        rotation_history: [
          {
            id: `rot_${Date.now()}`,
            rotated_at: nowIso,
            note: 'Initial secret created in vault',
          },
        ],
        created_at: nowIso,
        updated_at: nowIso,
      };
      onUpdateSecrets([newItem, ...secrets]);
      onLogAudit('create', newItem.label, newItem.id, `${newItem.product_name} (${newItem.environment})`);
      showToast('New secret encrypted with unique 12-byte IV.');
    }

    setIsFormOpen(false);
    setEditingItem(null);
  };

  // Rotate Secret Action
  const handleRotateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rotatingItem || !masterKey || !rotateNewSecret.trim()) return;

    const todayStr = new Date().toISOString().split('T')[0];
    const nowIso = new Date().toISOString();
    const interval = rotateIntervalDays > 0 ? rotateIntervalDays : rotatingItem.rotation_interval_days;
    const next_rotation_due = computeNextRotationDue(todayStr, interval);
    const newEncryptedValue = await encryptSecretString(rotateNewSecret.trim(), masterKey);

    const updatedItem: SecretItem = {
      ...rotatingItem,
      secret_value_encrypted: newEncryptedValue,
      last_rotated_date: todayStr,
      rotation_interval_days: interval,
      next_rotation_due,
      status: 'active',
      rotation_history: [
        {
          id: `rot_${Date.now()}`,
          rotated_at: nowIso,
          note: rotateNote.trim() || 'Scheduled key rotation completed',
        },
        ...(rotatingItem.rotation_history || []),
      ],
      updated_at: nowIso,
    };

    onUpdateSecrets(secrets.map((s) => (s.id === rotatingItem.id ? updatedItem : s)));
    onLogAudit(
      'rotate',
      updatedItem.label,
      updatedItem.id,
      `Rotated key · Next due: ${next_rotation_due || 'N/A'}`
    );
    showToast(`Rotated "${updatedItem.label}" · Next due ${next_rotation_due}`);
    setRotatingItem(null);
    setRotateNewSecret('');
    setRotateNote('');
  };

  // Soft Delete (Revoke) or Hard Delete
  const handleDeleteOrRevoke = (item: SecretItem) => {
    if (confirmDeleteId !== item.id) {
      setConfirmDeleteId(item.id);
      return;
    }

    // Permanently delete record on confirmation
    onUpdateSecrets(secrets.filter((s) => s.id !== item.id));
    onLogAudit('delete', item.label, item.id, 'Permanently deleted secret record');
    showToast(`"${item.label}" deleted from vault.`);
    if (inspectingItem?.id === item.id) setInspectingItem(null);
    setConfirmDeleteId(null);
  };

  // CSV Bulk Import (Metadata Only)
  const handleCsvImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      if (!text) return;
      const imported = parseSecretsMetadataCsv(text);
      if (imported.length === 0) {
        showToast('No valid metadata rows found in CSV.');
        return;
      }
      const existingIds = new Set(secrets.map((s) => s.id));
      const newItems: SecretItem[] = imported.filter((i) => !existingIds.has(i.id));
      onUpdateSecrets([...newItems, ...secrets]);
      onLogAudit('csv_import', `${newItems.length} metadata items`, undefined, 'Bulk CSV metadata import');
      showToast(`Imported ${newItems.length} secret metadata items! Click Rotate on each to paste secret values.`);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Export Metadata Only (CSV / JSON)
  const handleExportMetadata = (format: 'csv' | 'json') => {
    const content =
      format === 'csv'
        ? exportSecretsMetadataToCsv(secrets)
        : exportSecretsMetadataToJson(secrets);
    const mime = format === 'csv' ? 'text/csv' : 'application/json';
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `krypton_secrets_metadata_only_${new Date().toISOString().split('T')[0]}.${format}`;
    a.click();
    URL.revokeObjectURL(url);
    onLogAudit('metadata_export', `Exported ${secrets.length} items (${format.toUpperCase()})`);
    showToast(`Exported metadata-only ${format.toUpperCase()} (zero secret values included).`);
  };

  // Generate Scoped Read-Only Token for SaaS Stack Tracker (Stored permanently in Firebase Firestore)
  const handleCreateTrackerToken = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const data = await createTrackerTokenDirect(
        newTokenLabel.trim() || 'SaaS Stack Tracker Read Token'
      );
      setNewlyGeneratedRawToken(data.token);
      setTrackerTokens((prev) => [data.record, ...prev]);
      setNewTokenLabel('');
      onLogAudit('token_created', data.record.label, data.record.id, 'Scoped metadata:read token');
      showToast('Read-only StackTrack API token generated in Firestore.');
    } catch {
      showToast('Failed to create token.');
    }
  };

  const handleRevokeTrackerToken = async (tokenRecord: TrackerApiTokenRecord) => {
    try {
      const ok = await revokeTrackerTokenDirect(tokenRecord.id);
      if (ok) {
        setTrackerTokens((prev) =>
          prev.map((t) => (t.id === tokenRecord.id ? { ...t, revoked: true } : t))
        );
        onLogAudit('token_revoked', tokenRecord.label, tokenRecord.id);
        showToast('Tracker read-only token revoked immediately.');
      }
    } catch {
      showToast('Failed to revoke token.');
    }
  };

  // Render Status & Urgency Chip (Color + Explicit Text for Accessibility)
  const renderUrgencyChip = (item: SecretItem) => {
    const u = urgencyMap[item.id];
    if (!u) return null;

    if (u.level === 'overdue') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[11px] font-mono font-semibold bg-rose-500/15 text-rose-400 border border-rose-500/30 whitespace-nowrap">
          <AlertTriangle className="w-3 h-3 shrink-0" />
          <span>{u.label}</span>
        </span>
      );
    }
    if (u.level === 'due_soon') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[11px] font-mono font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/30 whitespace-nowrap">
          <Clock className="w-3 h-3 shrink-0" />
          <span>{u.label}</span>
        </span>
      );
    }
    if (u.level === 'inactive') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[11px] font-mono font-semibold bg-slate-800 text-slate-400 border border-slate-700 whitespace-nowrap">
          <span>{u.label}</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[11px] font-mono font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 whitespace-nowrap">
        <ShieldCheck className="w-3 h-3 shrink-0" />
        <span>{u.label}</span>
      </span>
    );
  };

  return (
    <div className="space-y-6 pb-24 max-w-full overflow-x-hidden">
      {/* ================= TOP HEADER & SUB-NAVIGATION ================= */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="min-w-0">
          <span className="text-[11px] font-mono text-emerald-400 block truncate">
            Zero-Knowledge SaaS Secrets Command Center
          </span>
          <h2 className="text-xl sm:text-2xl font-extrabold text-slate-100 tracking-tight">
            API Keys &amp; Secrets Vault
          </h2>
          <p className="text-xs text-slate-400">
            AES-256-GCM per-field 12-byte IV encryption · Read-only metadata bridge for SaaS Stack Tracker
          </p>
        </div>

        {/* Module Sub-Tabs */}
        <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-900 border border-slate-800 rounded-2xl self-start max-w-full">
          <button
            type="button"
            onClick={() => setSubTab('items')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap ${
              subTab === 'items'
                ? 'bg-emerald-600 text-white'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Secrets ({secrets.length})
          </button>
          <button
            type="button"
            onClick={() => setSubTab('tracker_api')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap ${
              subTab === 'tracker_api'
                ? 'bg-emerald-600 text-white'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Terminal className="w-3.5 h-3.5 shrink-0" />
            <span>Tracker API</span>
          </button>
          <button
            type="button"
            onClick={() => setSubTab('audit_log')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap ${
              subTab === 'audit_log'
                ? 'bg-emerald-600 text-white'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <History className="w-3.5 h-3.5 shrink-0" />
            <span>Audit Log ({auditLogs.length})</span>
          </button>
        </div>
      </div>

      {/* Deep-Link Banner if opened via /vault/api-keys/<id> */}
      {highlightedSecretId && (
        <div className="p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 text-emerald-300">
            <Link2 className="w-4 h-4 shrink-0" />
            <span>
              Opened via SaaS Tracker Deep Link:{' '}
              <code className="font-mono font-bold">/vault/api-keys/{highlightedSecretId}</code>
            </span>
          </div>
          {onClearHighlightedSecret && (
            <button
              type="button"
              onClick={onClearHighlightedSecret}
              className="text-slate-400 hover:text-white font-semibold"
            >
              Dismiss
            </button>
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* SUB-TAB 1: SECRETS VAULT LIST, DUE SOON PANEL, & BULK ACTIONS          */}
      {/* ===================================================================== */}
      {subTab === 'items' && (
        <div className="space-y-5">
          {/* 1. ROTATION REMINDERS ("DUE SOON" PANEL) */}
          <div className="p-4 sm:p-5 rounded-3xl bg-[#0c1220] border border-slate-800 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-emerald-400" />
                <h3 className="text-xs font-bold text-slate-200 font-mono">
                  Key Rotation &amp; Expiry Reminders
                </h3>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <label className="text-slate-400 font-mono text-[11px]">Custom Window (days):</label>
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={customWindowDays}
                  onChange={(e) => setCustomWindowDays(Math.max(1, parseInt(e.target.value, 10) || 30))}
                  className="w-16 h-8 px-2 rounded-lg bg-slate-950 border border-slate-700 text-center font-mono text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
              <button
                type="button"
                onClick={() => setDueFilter('all')}
                className={`p-3 rounded-2xl border text-left transition-all ${
                  dueFilter === 'all'
                    ? 'bg-slate-800 border-emerald-500/50'
                    : 'bg-slate-950/70 border-slate-800 hover:border-slate-700'
                }`}
              >
                <span className="text-[10px] font-mono text-slate-400">All Active Keys</span>
                <p className="text-lg font-mono font-extrabold text-slate-100 tabular-nums mt-0.5">
                  {secrets.filter((s) => s.status !== 'revoked').length}
                </p>
              </button>

              <button
                type="button"
                onClick={() => setDueFilter('overdue')}
                className={`p-3 rounded-2xl border text-left transition-all ${
                  dueFilter === 'overdue'
                    ? 'bg-rose-950/40 border-rose-500'
                    : 'bg-slate-950/70 border-rose-500/20 hover:border-rose-500/40'
                }`}
              >
                <span className="text-[10px] font-mono text-rose-400">Overdue / Expired</span>
                <p className="text-lg font-mono font-extrabold text-rose-400 tabular-nums mt-0.5">
                  {dueCounts.overdue}
                </p>
              </button>

              <button
                type="button"
                onClick={() => setDueFilter('due_7')}
                className={`p-3 rounded-2xl border text-left transition-all ${
                  dueFilter === 'due_7'
                    ? 'bg-amber-950/40 border-amber-500'
                    : 'bg-slate-950/70 border-amber-500/20 hover:border-amber-500/40'
                }`}
              >
                <span className="text-[10px] font-mono text-amber-300">Due in ≤ 7 Days</span>
                <p className="text-lg font-mono font-extrabold text-amber-300 tabular-nums mt-0.5">
                  {dueCounts.due7}
                </p>
              </button>

              <button
                type="button"
                onClick={() => setDueFilter('due_14')}
                className={`p-3 rounded-2xl border text-left transition-all ${
                  dueFilter === 'due_14'
                    ? 'bg-amber-950/40 border-amber-500'
                    : 'bg-slate-950/70 border-slate-800 hover:border-slate-700'
                }`}
              >
                <span className="text-[10px] font-mono text-amber-200">Due in ≤ 14 Days</span>
                <p className="text-lg font-mono font-extrabold text-slate-100 tabular-nums mt-0.5">
                  {dueCounts.due14}
                </p>
              </button>

              <button
                type="button"
                onClick={() => setDueFilter('due_custom')}
                className={`col-span-2 sm:col-span-1 p-3 rounded-2xl border text-left transition-all ${
                  dueFilter === 'due_custom'
                    ? 'bg-emerald-950/40 border-emerald-500'
                    : 'bg-slate-950/70 border-slate-800 hover:border-slate-700'
                }`}
              >
                <span className="text-[10px] font-mono text-emerald-400">
                  Due in ≤ {customWindowDays}d
                </span>
                <p className="text-lg font-mono font-extrabold text-emerald-400 tabular-nums mt-0.5">
                  {dueCounts.dueCustom}
                </p>
              </button>
            </div>
          </div>

          {/* 2. SEARCH, FILTERS & ACTION BAR */}
          <div className="space-y-3">
            <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by label, SaaS product, service (Stripe, Supabase, Telegram), tag, or ID..."
                  className="w-full h-11 pl-10 pr-4 rounded-2xl bg-slate-900/90 border border-slate-800 text-slate-100 placeholder-slate-500 text-xs sm:text-sm focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => csvInputRef.current?.click()}
                  className="h-11 px-3.5 rounded-2xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition-colors"
                  title="Bulk import metadata from CSV (secret values are never imported from CSV)"
                >
                  <Upload className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Import CSV</span>
                </button>
                <input
                  ref={csvInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  onChange={handleCsvImport}
                  className="hidden"
                />

                <button
                  type="button"
                  onClick={() => handleExportMetadata('csv')}
                  className="h-11 px-3.5 rounded-2xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition-colors"
                  title="Export Metadata Only as CSV"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Export CSV</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleExportMetadata('json')}
                  className="h-11 px-3.5 rounded-2xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition-colors"
                  title="Export Metadata Only as JSON"
                >
                  <FileJson className="w-3.5 h-3.5 text-amber-400" />
                  <span>JSON</span>
                </button>

                {demoSecretsInVault.length > 0 && (
                  <button
                    type="button"
                    onClick={handleDeleteAllDemoSecrets}
                    className="h-11 px-3.5 rounded-2xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-300 text-xs font-semibold flex items-center gap-1.5 transition-colors"
                    title="Delete all sample/demo API keys in one click"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                    <span>Delete Demo Keys ({demoSecretsInVault.length})</span>
                  </button>
                )}

                {!demoModeOff && secrets.length > 0 && demoSecretsInVault.length === 0 && (
                  <button
                    type="button"
                    onClick={onLoadDemoSecrets}
                    className="h-11 px-3.5 rounded-2xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 text-xs font-semibold flex items-center gap-1.5 transition-colors"
                    title="Load sample SaaS API keys"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Load Demo Keys</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={openCreateModal}
                  className="h-11 px-4 rounded-2xl bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white text-xs font-semibold flex items-center gap-1.5 shadow-lg shadow-emerald-950 transition-all"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add Secret Key</span>
                </button>
              </div>
            </div>

            {/* Demo Keys Active Banner with 1-Click Delete & Turn Off */}
            {demoSecretsInVault.length > 0 && (
              <div className="p-3 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2 text-cyan-200">
                  <Sparkles className="w-4 h-4 text-cyan-400 shrink-0" />
                  <span>
                    <strong>{demoSecretsInVault.length} Demo API Key(s)</strong> currently loaded in your vault for testing.
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleDeleteAllDemoSecrets}
                    className="px-3 py-1.5 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-rose-300 font-semibold flex items-center gap-1 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete Demo Keys</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleToggleDemoMode(true)}
                    className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 font-semibold transition-colors"
                  >
                    Delete &amp; Turn Off Demo
                  </button>
                </div>
              </div>
            )}

            {/* Filter Selectors Row */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              <select
                aria-label="Filter by SaaS Product"
                value={filterProduct}
                onChange={(e) => setFilterProduct(e.target.value)}
                className="h-9 px-3 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
              >
                <option value="all">All Products</option>
                {productOptions.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>

              <select
                aria-label="Filter by Service"
                value={filterService}
                onChange={(e) => setFilterService(e.target.value)}
                className="h-9 px-3 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
              >
                <option value="all">All Services</option>
                {serviceOptions.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>

              <select
                aria-label="Filter by Environment"
                value={filterEnv}
                onChange={(e) => setFilterEnv(e.target.value)}
                className="h-9 px-3 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
              >
                <option value="all">All Environments</option>
                <option value="production">Production</option>
                <option value="staging">Staging</option>
                <option value="dev">Development</option>
              </select>

              <select
                aria-label="Filter by Secret Type"
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
                className="h-9 px-3 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
              >
                <option value="all">All Types</option>
                {Object.entries(SECRET_TYPE_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>

              <select
                aria-label="Filter by Status"
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="col-span-2 sm:col-span-1 h-9 px-3 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
              >
                <option value="all">All Statuses</option>
                <option value="active">Active</option>
                <option value="rotated">Rotated</option>
                <option value="expired">Expired</option>
                <option value="revoked">Revoked</option>
              </select>
            </div>
          </div>

          {/* Active Reveal Countdown Banner */}
          {revealedItemId && revealCountdown !== null && (
            <div className="p-3 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-between text-xs text-amber-300">
              <div className="flex items-center gap-2 font-mono">
                <Clock className="w-4 h-4 animate-spin" />
                <span>Plaintext secret revealed in memory — auto-masking in {revealCountdown}s</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setRevealedItemId(null);
                  setRevealedPlaintext('');
                }}
                className="px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 font-semibold"
              >
                Hide Now
              </button>
            </div>
          )}

          {/* 3. SECRETS LIST: CARDS ON MOBILE (md:hidden) & TABLE ON DESKTOP (hidden md:block) */}
          {filteredSecrets.length > 0 ? (
            <>
              {/* DESKTOP TABLE VIEW */}
              <div className="hidden md:block rounded-3xl bg-[#0c1220] border border-slate-800 overflow-hidden shadow-xl">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-800 text-[11px] font-mono text-slate-400 bg-slate-950/60">
                        <th className="py-3.5 px-4">Label &amp; Tracker ID</th>
                        <th className="py-3.5 px-4">SaaS Product &amp; Service</th>
                        <th className="py-3.5 px-3">Env &amp; Type</th>
                        <th className="py-3.5 px-4">Secret Value (AES-256-GCM)</th>
                        <th className="py-3.5 px-4">Rotation / Expiry Status</th>
                        <th className="py-3.5 px-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/70 text-xs">
                      {filteredSecrets.map((item) => {
                        const isRevealed = revealedItemId === item.id;
                        return (
                          <tr
                            key={item.id}
                            className={`hover:bg-slate-900/50 transition-colors ${
                              item.status === 'revoked' ? 'opacity-60' : ''
                            }`}
                          >
                            <td className="py-3.5 px-4 align-top">
                              <button
                                type="button"
                                onClick={() => setInspectingItem(item)}
                                className="font-bold text-slate-100 hover:text-emerald-400 text-left block"
                              >
                                {item.label}
                              </button>
                              <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-mono text-slate-500 mt-1">
                                <span className="truncate max-w-[180px]">ID: {item.id}</span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    navigator.clipboard?.writeText(item.id);
                                    showToast(`Copied Tracker Ref ID: ${item.id}`);
                                  }}
                                  className="text-emerald-400 hover:underline whitespace-nowrap font-semibold"
                                  title="Copy Stable ID for SaaS Tracker"
                                >
                                  Copy ID
                                </button>
                              </div>
                            </td>

                            <td className="py-3.5 px-4 align-top">
                              <p className="font-semibold text-slate-200">{item.product_name}</p>
                              <p className="text-[11px] text-slate-400 font-mono mt-0.5">
                                {item.service_name}
                              </p>
                            </td>

                            <td className="py-3.5 px-3 align-top whitespace-nowrap">
                              <span className="font-mono font-semibold text-slate-200 uppercase text-[11px]">
                                {item.environment}
                              </span>
                              <p className="text-[10px] text-slate-400 mt-0.5">
                                {SECRET_TYPE_LABELS[item.secret_type]}
                              </p>
                            </td>

                            <td className="py-3.5 px-4 align-top font-mono">
                              {isRevealed ? (
                                <div className="max-w-[260px] xl:max-w-[340px] px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[11px] leading-relaxed break-all select-all shadow-inner">
                                  {revealedPlaintext}
                                </div>
                              ) : (
                                <span className="text-slate-500 tracking-widest inline-block py-1">
                                  ••••••••••••••••
                                </span>
                              )}
                            </td>

                            <td className="py-3.5 px-4 align-top whitespace-nowrap">
                              {renderUrgencyChip(item)}
                              <div className="text-[10px] font-mono text-slate-400 mt-1.5 tabular-nums">
                                Next: {item.next_rotation_due || item.expiry_date || 'Manual'}
                              </div>
                            </td>

                            <td className="py-3.5 px-4 align-top text-right whitespace-nowrap">
                              <div className="inline-flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => handleTriggerProtectedAction(item, 'reveal')}
                                  className="p-2 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300"
                                  title={isRevealed ? 'Hide Secret' : 'Reveal Secret (15s)'}
                                >
                                  {isRevealed ? (
                                    <EyeOff className="w-3.5 h-3.5 text-amber-400" />
                                  ) : (
                                    <Eye className="w-3.5 h-3.5" />
                                  )}
                                </button>

                                <button
                                  type="button"
                                  onClick={() => handleTriggerProtectedAction(item, 'copy')}
                                  className="p-2 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300"
                                  title="Copy Secret (Auto-clears clipboard in 30s)"
                                >
                                  {copiedId === item.id ? (
                                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                                  ) : (
                                    <Copy className="w-3.5 h-3.5" />
                                  )}
                                </button>

                                <button
                                  type="button"
                                  onClick={() => {
                                    setRotatingItem(item);
                                    setRotateNewSecret('');
                                    setRotateNote('');
                                    setRotateIntervalDays(item.rotation_interval_days || 90);
                                  }}
                                  className="px-2.5 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 text-emerald-300 font-semibold flex items-center gap-1"
                                  title="Rotate Secret Value"
                                >
                                  <RefreshCw className="w-3.5 h-3.5" />
                                  <span>Rotate</span>
                                </button>

                                <button
                                  type="button"
                                  onClick={() => openEditModal(item)}
                                  className="p-2 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300"
                                  title="Edit Secret & Metadata"
                                >
                                  <Edit className="w-3.5 h-3.5" />
                                </button>

                                <button
                                  type="button"
                                  onClick={() => handleDeleteOrRevoke(item)}
                                  className={`px-2 py-1.5 rounded-lg border text-[11px] font-semibold transition-colors ${
                                    confirmDeleteId === item.id
                                      ? 'bg-rose-600 border-rose-500 text-white'
                                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-rose-400'
                                  }`}
                                  title={
                                    item.status === 'revoked'
                                      ? 'Permanently delete'
                                      : 'Soft delete (mark revoked)'
                                  }
                                >
                                  {confirmDeleteId === item.id ? (
                                    'Confirm?'
                                  ) : (
                                    <Trash2 className="w-3.5 h-3.5" />
                                  )}
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* MOBILE CARDS VIEW */}
              <div className="grid grid-cols-1 gap-3 md:hidden">
                {filteredSecrets.map((item) => {
                  const isRevealed = revealedItemId === item.id;
                  return (
                    <div
                      key={item.id}
                      className="p-4 rounded-3xl bg-[#0c1220] border border-slate-800 space-y-3 shadow-lg"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <button
                            type="button"
                            onClick={() => setInspectingItem(item)}
                            className="text-sm font-bold text-slate-100 hover:text-emerald-400 text-left"
                          >
                            {item.label}
                          </button>
                          <p className="text-xs text-slate-400 mt-0.5">
                            {item.product_name} · <span className="font-mono text-slate-300">{item.service_name}</span>
                          </p>
                        </div>
                        {renderUrgencyChip(item)}
                      </div>

                      <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
                        <span>
                          {item.environment.toUpperCase()} · {SECRET_TYPE_LABELS[item.secret_type]}
                        </span>
                        <span>Due: {item.next_rotation_due || item.expiry_date || 'N/A'}</span>
                      </div>

                      {/* Masked or Revealed Secret Box */}
                      <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800/90 flex items-center justify-between font-mono text-xs">
                        <span className={isRevealed ? 'text-amber-300 break-all' : 'text-slate-500 tracking-widest'}>
                          {isRevealed ? revealedPlaintext : '••••••••••••••••••••'}
                        </span>
                        <span className="text-[10px] text-slate-500 ml-2 shrink-0">AES-GCM</span>
                      </div>

                      {/* Mobile Thumb-Friendly Action Row */}
                      <div className="grid grid-cols-5 gap-1.5 pt-1">
                        <button
                          type="button"
                          onClick={() => handleTriggerProtectedAction(item, 'reveal')}
                          className="h-10 rounded-xl bg-slate-900 border border-slate-800 text-xs font-semibold text-slate-200 flex items-center justify-center gap-1"
                        >
                          {isRevealed ? <EyeOff className="w-3.5 h-3.5 text-amber-400" /> : <Eye className="w-3.5 h-3.5" />}
                          <span>{isRevealed ? 'Hide' : 'Reveal'}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => handleTriggerProtectedAction(item, 'copy')}
                          className="h-10 rounded-xl bg-slate-900 border border-slate-800 text-xs font-semibold text-slate-200 flex items-center justify-center gap-1"
                        >
                          {copiedId === item.id ? (
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                          <span>Copy</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setRotatingItem(item);
                            setRotateNewSecret('');
                            setRotateNote('');
                            setRotateIntervalDays(item.rotation_interval_days || 90);
                          }}
                          className="h-10 rounded-xl bg-emerald-600/20 border border-emerald-500/30 text-xs font-semibold text-emerald-300 flex items-center justify-center gap-1"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          <span>Rotate</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => openEditModal(item)}
                          className="h-10 rounded-xl bg-slate-900 border border-slate-800 text-xs font-semibold text-slate-300 flex items-center justify-center gap-1"
                        >
                          <Edit className="w-3.5 h-3.5" />
                          <span>Edit</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => handleDeleteOrRevoke(item)}
                          className={`h-10 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1 transition-colors ${
                            confirmDeleteId === item.id
                              ? 'bg-rose-600 border-rose-500 text-white'
                              : 'bg-slate-900 border-slate-800 text-rose-400 hover:bg-rose-500/15'
                          }`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>{confirmDeleteId === item.id ? 'Sure?' : 'Del'}</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            /* Empty State */
            <div className="py-16 px-6 text-center rounded-3xl bg-slate-900/30 border border-slate-800 space-y-4">
              <div className="w-12 h-12 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center mx-auto text-emerald-400">
                <KeyRound className="w-6 h-6" />
              </div>
              <div className="space-y-1 max-w-md mx-auto">
                <h4 className="text-base font-bold text-slate-100">
                  {secrets.length === 0 ? 'Add Your First API Key or Secret' : 'No Matching Secrets Found'}
                </h4>
                <p className="text-xs text-slate-400">
                  {secrets.length === 0
                    ? 'Store API keys, database URLs, webhook secrets, and bot tokens across all your SaaS products with per-field 12-byte IV AES-256-GCM encryption.'
                    : 'Try adjusting your product, service, environment, or rotation due window filters.'}
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={openCreateModal}
                  className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1.5"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add Your First Key</span>
                </button>
                {secrets.length === 0 && !demoModeOff && (
                  <>
                    <button
                      type="button"
                      onClick={onLoadDemoSecrets}
                      className="px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5"
                    >
                      <Sparkles className="w-4 h-4 text-cyan-400" />
                      <span>Load Sample SaaS Keys</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleToggleDemoMode(true)}
                      className="px-3 py-2.5 rounded-xl bg-slate-950 hover:bg-slate-900 border border-slate-800 text-slate-400 hover:text-rose-400 text-xs font-semibold transition-colors"
                    >
                      Turn Off Demo Option
                    </button>
                  </>
                )}
                {secrets.length === 0 && demoModeOff && (
                  <button
                    type="button"
                    onClick={() => handleToggleDemoMode(false)}
                    className="px-3 py-2 rounded-xl text-[11px] font-mono text-slate-500 hover:text-slate-300 underline"
                  >
                    Re-enable Demo Keys Loader
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* SUB-TAB 2: SAAS TRACKER READ-ONLY API & SCOPED TOKENS                 */}
      {/* ===================================================================== */}
      {subTab === 'tracker_api' && (
        <div className="space-y-5">
          <div className="p-5 rounded-3xl bg-[#0c1220] border border-slate-800 space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <span className="text-[10px] font-mono text-emerald-400">
                  StackTrack Integration Surface
                </span>
                <h3 className="text-base font-bold text-slate-100 mt-0.5">
                  Read-Only Metadata API &amp; Revocable Scoped Tokens
                </h3>
                <p className="text-xs text-slate-400 mt-1 max-w-2xl">
                  Your external <strong className="text-slate-200">SaaS Stack Tracker</strong> app can query this endpoint using a scoped <code className="font-mono text-emerald-300">metadata:read</code> Bearer token to mirror <code className="font-mono text-slate-300">next_rotation_due</code>, <code className="font-mono text-slate-300">expiry_date</code>, and <code className="font-mono text-slate-300">status</code>. It strictly never exposes <code className="font-mono text-rose-300">secret_value</code> or <code className="font-mono text-rose-300">notes</code>.
                </p>
              </div>
            </div>

            {/* Endpoint Documentation Box */}
            <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-2 font-mono text-xs">
              <div className="flex items-center justify-between text-slate-400">
                <span>GET {window.location.origin}/api/tracker/metadata</span>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(`${window.location.origin}/api/tracker/metadata`);
                    showToast('Copied Metadata API Endpoint URL!');
                  }}
                  className="text-emerald-400 hover:underline text-[11px]"
                >
                  Copy Endpoint URL
                </button>
              </div>
              <p className="text-[11px] text-slate-500">
                Header: <span className="text-slate-300">Authorization: Bearer kv_ro_...</span>
              </p>
              <p className="text-[11px] text-slate-500">
                Deep Link Format: <span className="text-emerald-400">{window.location.origin}/vault/api-keys/&lt;id&gt;</span>
              </p>
            </div>

            {/* Generate New Scoped Token Form */}
            <form onSubmit={handleCreateTrackerToken} className="flex flex-col sm:flex-row gap-2.5">
              <input
                type="text"
                value={newTokenLabel}
                onChange={(e) => setNewTokenLabel(e.target.value)}
                placeholder="Token description (e.g. StackTrack Cloud Function Sync)"
                className="flex-1 h-11 px-3.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
              />
              <button
                type="submit"
                className="h-11 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center justify-center gap-1.5 shrink-0"
              >
                <KeyRound className="w-4 h-4" />
                <span>Generate Read-Only Token</span>
              </button>
            </form>

            {/* Newly Generated Token Banner (Shown Once) */}
            {newlyGeneratedRawToken && (
              <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/40 space-y-2 animate-fade-in">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-emerald-300">
                    New Read-Only Token Generated (Copy now — shown only once!)
                  </span>
                  <button
                    type="button"
                    onClick={() => setNewlyGeneratedRawToken(null)}
                    className="text-xs text-slate-400 hover:text-white"
                  >
                    Dismiss
                  </button>
                </div>
                <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-slate-950 border border-emerald-500/30 font-mono text-xs text-emerald-400">
                  <span className="break-all select-all">{newlyGeneratedRawToken}</span>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard?.writeText(newlyGeneratedRawToken);
                      showToast('Copied Read-Only Token!');
                    }}
                    className="px-3 py-1 rounded-lg bg-emerald-600 text-white text-xs font-sans font-semibold shrink-0"
                  >
                    Copy Token
                  </button>
                </div>
              </div>
            )}

            {/* Existing Tokens List */}
            <div className="space-y-2 pt-2">
              <h4 className="text-xs font-bold text-slate-300 font-mono">
                Issued Scoped Tokens ({trackerTokens.length})
              </h4>
              {trackerTokens.length > 0 ? (
                <div className="space-y-2">
                  {trackerTokens.map((tok) => (
                    <div
                      key={tok.id}
                      className="p-3 rounded-2xl bg-slate-950 border border-slate-800 flex items-center justify-between text-xs"
                    >
                      <div>
                        <p className="font-semibold text-slate-200">
                          {tok.label}{' '}
                          <span className="font-mono text-[11px] text-slate-400">
                            ({tok.tokenPreview})
                          </span>
                        </p>
                        <p className="text-[10px] font-mono text-slate-500 mt-0.5">
                          Scope: {tok.scope} · Created: {new Date(tok.createdAt).toLocaleDateString()}
                          {tok.lastUsedAt ? ` · Last used: ${new Date(tok.lastUsedAt).toLocaleTimeString()}` : ''}
                        </p>
                      </div>
                      <div>
                        {tok.revoked ? (
                          <span className="px-2.5 py-1 rounded-md bg-slate-900 text-slate-500 font-mono text-[11px]">
                            Revoked
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleRevokeTrackerToken(tok)}
                            className="px-3 py-1.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-400 font-semibold text-xs transition-colors"
                          >
                            Revoke Token
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-500 italic py-2">
                  No read-only tokens issued yet. Generate one above to connect StackTrack.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* SUB-TAB 3: SECURITY AUDIT LOG (WHO, WHAT, WHEN — ZERO SECRET VALUES)  */}
      {/* ===================================================================== */}
      {subTab === 'audit_log' && (
        <div className="p-5 rounded-3xl bg-[#0c1220] border border-slate-800 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-100">
                Cryptographic Secrets Audit Trail
              </h3>
              <p className="text-xs text-slate-400">
                Immutable activity log of reveal, copy, create, edit, rotate, delete, and token events. Secret values are never logged.
              </p>
            </div>
          </div>

          {auditLogs.length > 0 ? (
            <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
              {auditLogs.map((entry) => (
                <div
                  key={entry.id}
                  className="p-3 rounded-2xl bg-slate-950 border border-slate-800/80 flex items-center justify-between text-xs"
                >
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold uppercase text-emerald-400 text-[11px]">
                        [{entry.action}]
                      </span>
                      <span className="font-semibold text-slate-200">{entry.target_label}</span>
                      {entry.target_id && (
                        <span className="text-[10px] font-mono text-slate-500">
                          ({entry.target_id})
                        </span>
                      )}
                    </div>
                    {entry.details && (
                      <p className="text-[11px] text-slate-400">{entry.details}</p>
                    )}
                  </div>
                  <div className="text-right font-mono text-[10px] text-slate-400 shrink-0 ml-3">
                    <p>{entry.actor}</p>
                    <p>{new Date(entry.timestamp).toLocaleString()}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-500 italic py-6 text-center">
              No secret audit events recorded yet.
            </p>
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL 1: ADD / EDIT SECRET ITEM                                       */}
      {/* ===================================================================== */}
      <BottomSheet
        isOpen={isFormOpen}
        onClose={() => {
          setIsFormOpen(false);
          setEditingItem(null);
        }}
        title={editingItem ? `Edit Secret · ${editingItem.label}` : 'Add API Key / Secret'}
        subtitle="Encrypted client-side with AES-256-GCM (unique 12-byte IV per field)"
        maxHeight="max-h-[92vh]"
      >
        <form onSubmit={handleSaveSecretForm} className="space-y-4 pb-6">
          {/* Duplicate Detection Warning */}
          {duplicateWarningItem && (
            <div className="p-3.5 rounded-2xl bg-amber-500/15 border border-amber-500/40 flex items-start gap-2.5 text-xs text-amber-200">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold text-amber-300">Duplicate Active Secret Detected</p>
                <p className="text-[11px] mt-0.5">
                  An active secret (<strong className="text-white">{duplicateWarningItem.label}</strong>, ID:{' '}
                  <code className="font-mono">{duplicateWarningItem.id}</code>) already exists for{' '}
                  <strong>{formProduct}</strong> + <strong>{formService}</strong> in{' '}
                  <strong className="uppercase">{formEnv}</strong>. Consider using Rotate on the existing item instead.
                </p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Secret Label <span className="text-emerald-400">*</span>
              </label>
              <input
                type="text"
                required
                value={formLabel}
                onChange={(e) => setFormLabel(e.target.value)}
                placeholder="e.g. Stripe Live Secret Key"
                className="w-full h-11 px-3.5 rounded-xl bg-slate-900 border border-slate-800 text-sm text-slate-100 focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Stable Reference ID (for SaaS Tracker)
              </label>
              <input
                type="text"
                disabled={!!editingItem}
                value={formId}
                onChange={(e) => setFormId(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ''))}
                className="w-full h-11 px-3.5 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-slate-300 disabled:opacity-60"
              />
            </div>
          </div>

          {/* Product & Service with Autocomplete Datalists */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                SaaS Product Name <span className="text-emerald-400">*</span>
              </label>
              <input
                type="text"
                required
                list="vault-product-list"
                value={formProduct}
                onChange={(e) => setFormProduct(e.target.value)}
                placeholder="Shared / all products, Pharmacy SaaS..."
                className="w-full h-11 px-3.5 rounded-xl bg-slate-900 border border-slate-800 text-sm text-slate-100 focus:outline-none focus:border-emerald-500"
              />
              <datalist id="vault-product-list">
                {productOptions.map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Service / Provider Name <span className="text-emerald-400">*</span>
              </label>
              <input
                type="text"
                required
                list="vault-service-list"
                value={formService}
                onChange={(e) => setFormService(e.target.value)}
                placeholder="e.g. Telegram Bot API, Supabase, Cloudflare"
                className="w-full h-11 px-3.5 rounded-xl bg-slate-900 border border-slate-800 text-sm text-slate-100 focus:outline-none focus:border-emerald-500"
              />
              <datalist id="vault-service-list">
                {serviceOptions.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </div>
          </div>

          {/* Type, Environment, Status */}
          <div className="grid grid-cols-3 gap-2.5">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Secret Type</label>
              <select
                value={formType}
                onChange={(e) => setFormType(e.target.value as SecretType)}
                className="w-full h-11 px-3 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
              >
                {Object.entries(SECRET_TYPE_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Environment</label>
              <select
                value={formEnv}
                onChange={(e) => setFormEnv(e.target.value as SecretEnvironment)}
                className="w-full h-11 px-3 rounded-xl bg-slate-900 border border-slate-800 text-xs font-mono text-slate-100 focus:outline-none focus:border-emerald-500"
              >
                <option value="production">production</option>
                <option value="staging">staging</option>
                <option value="dev">dev</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Status</label>
              <select
                value={formStatus}
                onChange={(e) => setFormStatus(e.target.value as SecretStatus)}
                className="w-full h-11 px-3 rounded-xl bg-slate-900 border border-slate-800 text-xs font-mono text-slate-100 focus:outline-none focus:border-emerald-500"
              >
                <option value="active">active</option>
                <option value="rotated">rotated</option>
                <option value="expired">expired</option>
                <option value="revoked">revoked</option>
              </select>
            </div>
          </div>

          {/* Encrypted Secret Value Input */}
          <div className="p-3.5 rounded-2xl bg-slate-950 border border-emerald-500/30 space-y-2">
            <label className="block text-xs font-semibold text-emerald-400 font-mono">
              Secret Value (Encrypted with random 12-byte IV via AES-256-GCM)
            </label>
            <div className="relative">
              <input
                type={formShowSecret ? 'text' : 'password'}
                value={formSecretValue}
                onChange={(e) => setFormSecretValue(e.target.value)}
                placeholder="Paste sk_live_..., bot token, database URL, or SSH key..."
                className="w-full h-11 px-3.5 pr-10 rounded-xl bg-slate-900 border border-slate-700 text-xs font-mono text-slate-100 focus:outline-none focus:border-emerald-500"
              />
              <button
                type="button"
                onClick={() => setFormShowSecret(!formShowSecret)}
                className="absolute right-3 top-3 text-slate-400 hover:text-white"
              >
                {formShowSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Rotation Schedule & Expiry Dates */}
          <div className="p-3.5 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-200">
                Rotation Schedule &amp; Expiry
              </span>
              <div className="flex items-center gap-1">
                {[30, 60, 90, 180, 365].map((days) => (
                  <button
                    key={days}
                    type="button"
                    onClick={() => setFormIntervalDays(days)}
                    className={`px-2 py-0.5 rounded text-[10px] font-mono ${
                      formIntervalDays === days
                        ? 'bg-emerald-600 text-white'
                        : 'bg-slate-950 text-slate-400 hover:text-white'
                    }`}
                  >
                    {days}d
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <div>
                <label className="block text-[10px] font-mono text-slate-400 mb-1">
                  Last Rotated Date
                </label>
                <input
                  type="date"
                  value={formLastRotatedDate}
                  onChange={(e) => setFormLastRotatedDate(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-slate-100"
                />
              </div>

              <div>
                <label className="block text-[10px] font-mono text-slate-400 mb-1">
                  Rotation Interval (Days)
                </label>
                <input
                  type="number"
                  min={0}
                  value={formIntervalDays}
                  onChange={(e) => setFormIntervalDays(parseInt(e.target.value, 10) || 0)}
                  className="w-full h-10 px-3 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-slate-100"
                />
              </div>

              <div>
                <label className="block text-[10px] font-mono text-slate-400 mb-1">
                  Hard Expiry Date (Optional)
                </label>
                <input
                  type="date"
                  value={formExpiryDate}
                  onChange={(e) => setFormExpiryDate(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-slate-100"
                />
              </div>
            </div>
          </div>

          {/* Optional Plain Metadata: Login URL, Account Email, Username */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Provider Login URL
              </label>
              <input
                type="url"
                value={formLoginUrl}
                onChange={(e) => setFormLoginUrl(e.target.value)}
                placeholder="https://dashboard.stripe.com"
                className="w-full h-10 px-3 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-100"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Account Email
              </label>
              <input
                type="email"
                value={formEmail}
                onChange={(e) => setFormEmail(e.target.value)}
                placeholder="ops@company.com"
                className="w-full h-10 px-3 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-100"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Username / Org ID
              </label>
              <input
                type="text"
                value={formUsername}
                onChange={(e) => setFormUsername(e.target.value)}
                placeholder="org_prod_01"
                className="w-full h-10 px-3 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-100"
              />
            </div>
          </div>

          {/* Tags & Encrypted Notes */}
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              Tags (comma-separated)
            </label>
            <input
              type="text"
              value={formTags}
              onChange={(e) => setFormTags(e.target.value)}
              placeholder="payments, critical, webhook"
              className="w-full h-10 px-3 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-100"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              Encrypted Notes (AES-256-GCM encrypted before saving)
            </label>
            <textarea
              rows={2}
              value={formNotes}
              onChange={(e) => setFormNotes(e.target.value)}
              placeholder="Where this key is deployed, IAM permissions, recovery instructions..."
              className="w-full p-3 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-100"
            />
          </div>

          <div className="pt-2 flex items-center justify-end gap-3 border-t border-slate-800">
            <button
              type="button"
              onClick={() => setIsFormOpen(false)}
              className="px-4 py-2.5 rounded-xl border border-slate-700 text-xs text-slate-300"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold"
            >
              Encrypt &amp; Save Secret
            </button>
          </div>
        </form>
      </BottomSheet>

      {/* ===================================================================== */}
      {/* MODAL 2: ROTATE SECRET VALUE                                          */}
      {/* ===================================================================== */}
      {rotatingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
          <form
            onSubmit={handleRotateSubmit}
            className="w-full max-w-md rounded-3xl bg-[#0d1526] border border-emerald-500/30 p-6 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h4 className="text-base font-bold text-slate-100 flex items-center gap-2">
                <RefreshCw className="w-4 h-4 text-emerald-400" />
                Rotate Secret Key
              </h4>
              <button
                type="button"
                onClick={() => setRotatingItem(null)}
                className="text-xs text-slate-400 hover:text-white"
              >
                Close
              </button>
            </div>

            <p className="text-xs text-slate-400">
              Rotating <strong className="text-slate-200">{rotatingItem.label}</strong> ({rotatingItem.product_name} · {rotatingItem.environment}). Updates <code className="font-mono">last_rotated_date</code> to today and logs a rotation history entry without keeping the old secret value.
            </p>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                New Secret Value <span className="text-emerald-400">*</span>
              </label>
              <input
                type="password"
                required
                value={rotateNewSecret}
                onChange={(e) => setRotateNewSecret(e.target.value)}
                placeholder="Paste newly generated key / token..."
                className="w-full h-11 px-3.5 rounded-xl bg-slate-950 border border-slate-700 text-xs font-mono text-slate-100 focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Next Interval (Days)
                </label>
                <input
                  type="number"
                  min={1}
                  value={rotateIntervalDays}
                  onChange={(e) => setRotateIntervalDays(parseInt(e.target.value, 10) || 90)}
                  className="w-full h-10 px-3 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-slate-100"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Rotation Note
                </label>
                <input
                  type="text"
                  value={rotateNote}
                  onChange={(e) => setRotateNote(e.target.value)}
                  placeholder="e.g. Q4 scheduled rotation"
                  className="w-full h-10 px-3 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-100"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setRotatingItem(null)}
                className="px-4 py-2 rounded-xl border border-slate-700 text-xs text-slate-300"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold"
              >
                Complete Rotation
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL 3: STEP-UP MASTER PASSWORD VERIFICATION (IF > 60s SINCE UNLOCK) */}
      {/* ===================================================================== */}
      {stepUpModal.isOpen && stepUpModal.item && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
          <form
            onSubmit={handleStepUpSubmit}
            className="w-full max-w-sm rounded-3xl bg-[#0d1526] border border-emerald-500/40 p-6 space-y-4 shadow-2xl"
          >
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                <Lock className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-slate-100">
                  Confirm Master Passphrase
                </h4>
                <p className="text-[11px] text-slate-400">
                  Required after 60s of session age to {stepUpModal.intent} secret
                </p>
              </div>
            </div>

            <input
              type="password"
              required
              autoFocus
              value={stepUpPassphrase}
              onChange={(e) => {
                setStepUpPassphrase(e.target.value);
                if (stepUpError) setStepUpError(null);
              }}
              placeholder="Enter Vault Master Passphrase..."
              className="w-full h-11 px-3.5 rounded-xl bg-slate-950 border border-slate-700 text-sm text-slate-100 focus:outline-none focus:border-emerald-500"
            />

            {stepUpError && (
              <p className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-xl p-2 text-center">
                {stepUpError}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setStepUpModal({ isOpen: false, item: null, intent: 'reveal' })}
                className="px-4 py-2 rounded-xl border border-slate-700 text-xs text-slate-300"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isVerifyingStepUp}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold"
              >
                {isVerifyingStepUp ? 'Verifying...' : 'Verify & Unlock (60s)'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL 4: SECRET DETAIL, DEEP LINK, & ROTATION HISTORY INSPECTOR       */}
      {/* ===================================================================== */}
      <BottomSheet
        isOpen={!!inspectingItem}
        onClose={() => {
          setInspectingItem(null);
          if (onClearHighlightedSecret) onClearHighlightedSecret();
        }}
        title={inspectingItem?.label || 'Secret Inspector'}
        subtitle={
          inspectingItem
            ? `${inspectingItem.product_name} · ${inspectingItem.service_name} (${inspectingItem.environment})`
            : ''
        }
        maxHeight="max-h-[90vh]"
      >
        {inspectingItem && (
          <div className="space-y-5 pb-6 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              {renderUrgencyChip(inspectingItem)}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const deepLink = `${window.location.origin}/vault/api-keys/${inspectingItem.id}`;
                    navigator.clipboard?.writeText(deepLink);
                    showToast('Copied Deep Link for SaaS Stack Tracker!');
                  }}
                  className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-emerald-400 font-mono text-[11px] flex items-center gap-1.5"
                >
                  <Link2 className="w-3.5 h-3.5" />
                  <span>Copy Tracker Deep Link</span>
                </button>
                {inspectingItem.login_url && (
                  <a
                    href={inspectingItem.login_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 flex items-center gap-1"
                  >
                    <span>Provider Console</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            </div>

            {/* Secret Value & Encrypted Notes Box */}
            <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] text-slate-400">
                  AES-256-GCM Encrypted Value (12-byte IV)
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleTriggerProtectedAction(inspectingItem, 'reveal')}
                    className="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-700 text-slate-200 flex items-center gap-1"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>{revealedItemId === inspectingItem.id ? 'Hide' : 'Reveal (15s)'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleTriggerProtectedAction(inspectingItem, 'copy')}
                    className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white font-semibold flex items-center gap-1"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy Value</span>
                  </button>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-slate-900 font-mono text-xs break-all">
                {revealedItemId === inspectingItem.id ? (
                  <span className="text-amber-300 select-all">{revealedPlaintext}</span>
                ) : (
                  <span className="text-slate-500 tracking-widest">
                    ••••••••••••••••••••••••••••••••
                  </span>
                )}
              </div>

              {revealedItemId === inspectingItem.id && revealedNotes && (
                <div className="pt-2 border-t border-slate-800">
                  <span className="text-[10px] font-mono text-slate-400 block mb-1">
                    Decrypted Notes:
                  </span>
                  <p className="text-slate-300 whitespace-pre-wrap">{revealedNotes}</p>
                </div>
              )}
            </div>

            {/* Metadata Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 font-mono">
              <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800">
                <span className="text-[10px] text-slate-400 block">Tracker Reference ID</span>
                <span className="text-slate-100 font-bold break-all">{inspectingItem.id}</span>
              </div>
              <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800">
                <span className="text-[10px] text-slate-400 block">Last Rotated</span>
                <span className="text-slate-100 font-bold">{inspectingItem.last_rotated_date}</span>
              </div>
              <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800">
                <span className="text-[10px] text-slate-400 block">Next Rotation Due</span>
                <span className="text-emerald-400 font-bold">
                  {inspectingItem.next_rotation_due || 'Not scheduled'}
                </span>
              </div>
              {inspectingItem.account_email && (
                <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800">
                  <span className="text-[10px] text-slate-400 block">Account Email</span>
                  <span className="text-slate-200">{inspectingItem.account_email}</span>
                </div>
              )}
              {inspectingItem.username && (
                <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800">
                  <span className="text-[10px] text-slate-400 block">Username</span>
                  <span className="text-slate-200">{inspectingItem.username}</span>
                </div>
              )}
              {inspectingItem.expiry_date && (
                <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800">
                  <span className="text-[10px] text-slate-400 block">Hard Expiry Date</span>
                  <span className="text-amber-300 font-bold">{inspectingItem.expiry_date}</span>
                </div>
              )}
            </div>

            {/* Rotation History Log (Never stores old secret values) */}
            <div className="space-y-2">
              <h5 className="font-mono text-[11px] text-slate-400 font-bold">
                Rotation &amp; Lifecycle History ({inspectingItem.rotation_history?.length || 0})
              </h5>
              <div className="space-y-1.5 max-h-44 overflow-y-auto">
                {(inspectingItem.rotation_history || []).map((h) => (
                  <div
                    key={h.id}
                    className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between"
                  >
                    <span className="text-slate-300">{h.note}</span>
                    <span className="font-mono text-[10px] text-slate-500 shrink-0 ml-2">
                      {new Date(h.rotated_at).toLocaleDateString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </BottomSheet>
    </div>
  );
};
