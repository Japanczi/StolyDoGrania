// Saves a file streamed from the server (DotNetStreamReference) through a temporary link.
// Resolves only once the whole file has arrived, so the server can safely act on a finished download.
window.downloadFileFromStream = async (fileName, streamRef) => {
    const buffer = await streamRef.arrayBuffer();
    const url = URL.createObjectURL(new Blob([buffer]));
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName ?? "";
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
};
