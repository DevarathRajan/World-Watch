const { app, BrowserWindow, screen } = require("electron");
const { spawn } = require("child_process");
const path = require("path");

let win    = null;
let server = null;

// WM_ELECTRON_ONLY is set when server.py launches us — means Python is already
// running, so we just open the window and skip spawning it again.
const serverAlreadyRunning = process.env.WM_ELECTRON_ONLY === "1";
const PORT = process.env.WM_PORT || "9766";

app.whenReady().then(() => {

  if (!serverAlreadyRunning) {
    // npm start was called directly — start the Python server ourselves
    const python = path.join(__dirname, ".venv", "Scripts", "python.exe");
    server = spawn(python, [path.join(__dirname, "server.py")], {
      cwd: __dirname,
      env: { ...process.env, WM_ELECTRON_ONLY: "1" },
    });
    server.stdout.on("data", d => console.log("[WM Server]", d.toString().trim()));
    server.stderr.on("data", d => console.error("[WM Server]", d.toString().trim()));
  }

  // Give the server a moment to bind before opening the window
  const delay = serverAlreadyRunning ? 200 : 1500;
  setTimeout(() => {
    const { workAreaSize } = screen.getPrimaryDisplay();
    win = new BrowserWindow({
      width:  workAreaSize.width,
      height: workAreaSize.height,
      x: 0, y: 0,
      frame: false,
      backgroundColor: "#010508",
      webPreferences: { contextIsolation: true, nodeIntegration: false },
    });
    win.loadURL(`http://localhost:${PORT}`);
    win.on("closed", () => { win = null; });
  }, delay);

});

app.on("window-all-closed", () => {
  if (server) server.kill();
  app.quit();
});
