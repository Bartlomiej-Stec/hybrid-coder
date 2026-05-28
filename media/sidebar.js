(function () {
  const vscode = acquireVsCodeApi();

  const $ = (id) => document.getElementById(id);

  const prompt = $("prompt");
  const webchatResponse = $("webchatResponse");
  const fileList = $("fileList");
  const loadingIndicator = $("loadingIndicator");
  const statusLine = $("statusLine");
  const finalStatus = $("finalStatus");
  const preview = $("preview");

  const btnFind = $("btnFind");
  const btnCopy = $("btnCopy");
  const btnApply = $("btnApply");
  const btnAddFile = $("btnAddFile");
  const btnSelectAll = $("btnSelectAll");
  const btnSelectNone = $("btnSelectNone");
  const btnSettings = $("btnSettings");

  let state = vscode.getState() || { prompt: "", webchatResponse: "", files: [] };
  prompt.value = state.prompt || "";
  webchatResponse.value = state.webchatResponse || "";

  function saveState() {
    vscode.setState({
      prompt: prompt.value,
      webchatResponse: webchatResponse.value,
      files: state.files,
    });
  }

  function renderFiles(files) {
    state.files = files;
    fileList.innerHTML = "";

    files.forEach((file, index) => {
      const row = document.createElement("div");
      row.className = "file-item";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = file.selected;
      checkbox.disabled = !file.exists;
      checkbox.addEventListener("change", () => {
        vscode.postMessage({ type: "toggleFile", index });
      });

      const pathEl = document.createElement("span");
      pathEl.className = "file-path";
      pathEl.textContent = file.relativePath;
      pathEl.title = file.relativePath;
      if (!file.exists) pathEl.classList.add("missing");
      if (file.tooLarge) pathEl.classList.add("toolarge");
      pathEl.addEventListener("click", () => {
        if (file.exists) vscode.postMessage({ type: "openFile", index });
      });

      const badge = document.createElement("span");
      badge.className = "file-badge";
      if (!file.exists) {
        badge.textContent = "missing";
      } else if (file.tooLarge) {
        badge.textContent = "large";
      } else {
        badge.textContent = formatSize(file.size);
      }

      const langBadge = document.createElement("span");
      langBadge.className = "file-badge";
      langBadge.textContent = file.language || "?";

      const remove = document.createElement("button");
      remove.className = "file-remove";
      remove.textContent = "×";
      remove.title = "Remove from list";
      remove.addEventListener("click", () => {
        vscode.postMessage({ type: "removeFile", index });
      });

      row.appendChild(checkbox);
      row.appendChild(pathEl);
      row.appendChild(langBadge);
      row.appendChild(badge);
      row.appendChild(remove);
      fileList.appendChild(row);
    });

    saveState();
  }

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + "B";
    return Math.round(bytes / 1024) + "KB";
  }

  btnFind.addEventListener("click", () => {
    fileList.classList.add("searching");
    loadingIndicator.style.display = "flex";
    finalStatus.style.display = "none";
    btnFind.disabled = true;
    vscode.postMessage({ type: "findFiles", prompt: prompt.value });
  });

  btnCopy.addEventListener("click", () => {
    vscode.postMessage({ type: "copyContext", prompt: prompt.value, files: state.files });
  });

  btnApply.addEventListener("click", () => {
    vscode.postMessage({
      type: "applyChanges",
      webchatResponse: webchatResponse.value,
      prompt: prompt.value,
      files: state.files,
    });
  });

  btnAddFile.addEventListener("click", () => {
    vscode.postMessage({ type: "addFile" });
  });

  btnSelectAll.addEventListener("click", () => {
    vscode.postMessage({ type: "selectAll", value: true });
  });

  btnSelectNone.addEventListener("click", () => {
    vscode.postMessage({ type: "selectAll", value: false });
  });

  btnSettings.addEventListener("click", () => {
    vscode.postMessage({ type: "openSettings" });
  });

  prompt.addEventListener("input", saveState);
  webchatResponse.addEventListener("input", saveState);

  document.querySelectorAll(".collapsible .toggle").forEach((toggle) => {
    toggle.addEventListener("click", () => {
      toggle.parentElement.classList.toggle("collapsed");
    });
  });

  let isSearching = false;

  function hideLoading() {
    fileList.classList.remove("searching");
    loadingIndicator.style.display = "none";
    btnFind.disabled = false;
    isSearching = false;
  }

  window.addEventListener("message", (event) => {
    const msg = event.data;
    switch (msg.type) {
      case "files":
        renderFiles(msg.files);
        hideLoading();
        finalStatus.textContent = "Found " + msg.files.length + " files";
        finalStatus.style.display = "flex";
        break;
      case "status":
        if (isSearching) {
          const text = msg.text.replace(/\.+$/, "");
          statusLine.textContent = text;
          if (text.startsWith("No files") || text.startsWith("Error")) {
            hideLoading();
          }
        } else {
          statusLine.textContent = msg.text;
        }
        break;
      case "contextReady":
        preview.textContent = msg.markdown;
        break;
    }
  });

  if (state.files && state.files.length) {
    renderFiles(state.files);
    vscode.postMessage({ type: "restoreState", files: state.files });
  }
})();