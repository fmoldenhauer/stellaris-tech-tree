/* Parsing and decompression stay off the UI thread, including for late-game saves. */
importScripts('save-import-core.js');
self.onmessage = async function (event) {
    try {
        var result = await StellarisSave.readSave(event.data);
        self.postMessage({ result: result });
    } catch (error) {
        self.postMessage({ error: error.message || 'Unable to read this save.' });
    }
};
