// `fetch` can't report upload progress, and a 100 MB file can take minutes on
// a slow connection, so the capture dialog posts through XHR instead.

export class UploadNetworkError extends Error {
  constructor() {
    super("The upload was interrupted.");
    this.name = "UploadNetworkError";
  }
}

/** Posts `body` to a Convex storage upload URL and returns the storage id. */
export function uploadWithProgress(
  url: string,
  body: Blob,
  contentType: string,
  onProgress: (fraction: number) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", url);
    request.setRequestHeader("Content-Type", contentType);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(event.loaded / event.total);
      }
    };
    request.onerror = () => reject(new UploadNetworkError());
    request.onabort = () => reject(new UploadNetworkError());
    request.onload = () => {
      if (request.status < 200 || request.status >= 300) {
        reject(new Error(`Upload failed with status ${request.status}`));
        return;
      }
      try {
        const { storageId } = JSON.parse(request.responseText) as {
          storageId?: unknown;
        };
        if (typeof storageId !== "string") throw new Error("No storageId");
        resolve(storageId);
      } catch {
        reject(new Error("Upload response was not understood"));
      }
    };
    request.send(body);
  });
}
