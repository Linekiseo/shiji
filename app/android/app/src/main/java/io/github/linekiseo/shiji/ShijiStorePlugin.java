package io.github.linekiseo.shiji;

import android.util.AtomicFile;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

/** Durable metadata, with AtomicFile rollback if the process stops during a write. */
@CapacitorPlugin(name = "ShijiStore")
public class ShijiStorePlugin extends Plugin {
    private SnapshotStore store() { return new SnapshotStore(new File(getContext().getFilesDir(), "shiji-state.json")); }
    @PluginMethod
    public synchronized void read(PluginCall call) {
        try {
            String json = store().read();
            JSObject result = new JSObject();
            result.put("json", json == null ? JSONObject.NULL : json);
            call.resolve(result);
        } catch (Exception error) { call.reject("Could not read saved records", error); }
    }
    @PluginMethod
    public synchronized void write(PluginCall call) {
        String json = call.getString("json");
        if (json == null) { call.reject("Missing snapshot"); return; }
        try {
            store().write(json);
            call.resolve();
        } catch (Exception error) {
            call.reject("Could not save records", error);
        }
    }
}
