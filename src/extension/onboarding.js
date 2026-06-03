const statusNode = document.getElementById("status");
const checkButton = document.getElementById("capture-check");

function updateStatus(message, level = "info") {
  if (!statusNode) {
    return;
  }

  statusNode.textContent = message;
  statusNode.classList.remove("error", "success");
  if (level === "error") {
    statusNode.classList.add("error");
    return;
  }

  if (level === "success") {
    statusNode.classList.add("success");
  }
}

async function runCaptureCheck() {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    updateStatus("This browser does not expose getDisplayMedia. Use Chrome or Edge for capture-heavy flows.", "error");
    return;
  }

  updateStatus("Waiting for browser picker selection...");

  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: false,
    });

    stream.getTracks().forEach((track) => track.stop());
    updateStatus("Capture permission is working. You are ready for multi-page TOC capture.", "success");
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotAllowedError") {
      updateStatus(
        "Permission denied (NotAllowedError). Enable macOS Screen Recording for Edge/Chrome, then retry this check.",
        "error"
      );
      return;
    }

    if (error instanceof DOMException && error.name === "AbortError") {
      updateStatus("Capture source picker was canceled. Re-run the check and select a window/tab.", "error");
      return;
    }

    const detail = error instanceof Error ? error.message : "Unknown error";
    updateStatus(`Capture check failed: ${detail}`, "error");
  }
}

checkButton?.addEventListener("click", () => {
  void runCaptureCheck();
});
