package com.kryptonvault.zeroknowledge;

import android.os.Bundle;
import android.view.Window;
import android.view.WindowManager;
import android.graphics.Color;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        Window window = getWindow();
        if (window != null) {
            // Hardware OS-level screenshot, screen-recording, and Android Recents switcher masking
            window.setFlags(
                WindowManager.LayoutParams.FLAG_SECURE,
                WindowManager.LayoutParams.FLAG_SECURE
            );
            // Match Krypton Obsidian status & navigation bar colors
            window.setStatusBarColor(Color.parseColor("#07090E"));
            window.setNavigationBarColor(Color.parseColor("#07090E"));
        }
    }
}

