package io.github.linekiseo.shiji;

import android.util.AtomicFile;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

final class SnapshotStore {
    private final AtomicFile file;
    SnapshotStore(File path) { file = new AtomicFile(path); }
    synchronized String read() throws Exception {
        if (!file.getBaseFile().exists()) return null;
        String json = new String(file.readFully(), StandardCharsets.UTF_8);
        validate(json);
        return json;
    }
    synchronized void write(String json) throws Exception {
        validate(json);
        FileOutputStream output = null;
        try {
            output = file.startWrite();
            output.write(json.getBytes(StandardCharsets.UTF_8));
            file.finishWrite(output);
        } catch (Exception error) {
            if (output != null) file.failWrite(output);
            throw error;
        }
    }
    private void validate(String json) throws Exception {
        JSONObject data = new JSONObject(json);
        if (data.getInt("version") != 1) throw new IllegalArgumentException("Unsupported snapshot version");
        data.getJSONObject("slots");
    }
}
