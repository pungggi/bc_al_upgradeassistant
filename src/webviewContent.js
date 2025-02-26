function getWebviewContent() {
  return `
    <!DOCTYPE html>
    <html>
    <body>
      <div id="dropZone" style="padding: 20px; border: 2px dashed #ccc;">
        Drop files here to read their content.
      </div>
      <pre id="content"></pre>

      <script>
        const dropZone = document.getElementById('dropZone');
        const contentElement = document.getElementById('content');

        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
          dropZone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
          });
        });

        dropZone.addEventListener('drop', (e) => {
          const files = e.dataTransfer.files;
          if (files.length > 0) {
            const file = files[0];
            const reader = new FileReader();
            reader.onload = (event) => {
              const content = event.target.result;
              contentElement.textContent = content;
              vscode.postMessage({
                command: 'fileDropped',
                content: content
              });
            };
            reader.readAsText(file);
          }
        });
      </script>
    </body>
    </html>
  `;
}

module.exports = {
  getWebviewContent,
};
