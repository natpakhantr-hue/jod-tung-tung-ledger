package com.jodtungtung.ledger;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(GalleryScanPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
