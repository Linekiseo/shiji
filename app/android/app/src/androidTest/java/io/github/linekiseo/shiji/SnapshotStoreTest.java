package io.github.linekiseo.shiji;

import static org.junit.Assert.*;
import android.content.Context;
import android.util.AtomicFile;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class SnapshotStoreTest {
    private File temporaryFile() {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        assertEquals("io.github.linekiseo.shiji", context.getPackageName());
        return new File(context.getCacheDir(), "snapshot-test-" + UUID.randomUUID() + ".json");
    }
    @Test public void unicodeRecordsSurviveNewStoreInstance() throws Exception {
        File path = temporaryFile();
        String json = "{\"version\":1,\"slots\":{\"items\":[{\"title\":\"记录工作 ✓\"}]}}";
        assertNull(new SnapshotStore(path).read());
        new SnapshotStore(path).write(json);
        assertEquals(json, new SnapshotStore(path).read());
        path.delete();
    }
    @Test public void invalidWriteDoesNotReplaceSavedWork() throws Exception {
        File path = temporaryFile();
        SnapshotStore store = new SnapshotStore(path);
        String original = "{\"version\":1,\"slots\":{\"items\":[]}}";
        store.write(original);
        try { store.write("{\"version\":99,\"slots\":{}}"); fail("Unsupported version was accepted"); } catch (IllegalArgumentException expected) { }
        assertEquals(original, store.read());
        path.delete();
    }
    @Test public void interruptedWriteRetainsPreviousSnapshot() throws Exception {
        File path = temporaryFile();
        String original = "{\"version\":1,\"slots\":{}}";
        new SnapshotStore(path).write(original);
        AtomicFile file = new AtomicFile(path);
        FileOutputStream pending = file.startWrite();
        pending.write("partial data".getBytes(StandardCharsets.UTF_8));
        file.failWrite(pending);
        assertEquals(original, new SnapshotStore(path).read());
        path.delete();
    }
}
