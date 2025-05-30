import { app, Tray, Menu, dialog, shell } from "electron";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { SerialPort } from "serialport";
import fs from "fs";
import AdmZip from "adm-zip";
import { exec } from "child_process";
import os from "os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let tray;
const downloadsBaseDir = path.join(__dirname, "downloads");
const sketchName = "electroblocks_code";
const inoFolder = path.join(downloadsBaseDir, sketchName);
const inoFilePath = path.join(inoFolder, `${sketchName}.ino`);
const hexFilePath = path.join(inoFolder, `${sketchName}.hex`);
const userDownloads = path.join(os.homedir(), "Downloads");
const downloadedInoPath = path.join(userDownloads, `${sketchName}.ino`);

const startInoWatcher = () => {
  setInterval(() => {
    if (fs.existsSync(downloadedInoPath)) {
      if (!fs.existsSync(inoFolder)) fs.mkdirSync(inoFolder, { recursive: true });
      try {
        fs.renameSync(downloadedInoPath, inoFilePath);
        buildTrayMenu();
      } catch (err) {
        console.error("Error moving .ino file:", err);
      }
    }
  }, 3000);
};

const unzipBuildIfNeeded = () => {
  const zipPath = path.join(__dirname, "build.zip");
  const buildPath = path.join(__dirname, "build");
  const tempPath = path.join(__dirname, "temp_unzip");

  if (fs.existsSync(zipPath) && !fs.existsSync(buildPath)) {
    try {
      const zip = new AdmZip(zipPath);
      zip.extractAllTo(tempPath, true);

      const innerBuildPath = path.join(tempPath, "build");
      if (fs.existsSync(innerBuildPath)) {
        fs.renameSync(innerBuildPath, buildPath);
        fs.rmSync(tempPath, { recursive: true, force: true });
      } else {
        fs.renameSync(tempPath, buildPath);
      }

      fs.unlinkSync(zipPath);
    } catch (err) {
      console.error("Error unzipping build.zip:", err);
    }
  }
};

const startExpressServer = () => {
  const expressApp = express();
  const staticPath = path.join(__dirname, "build");

  expressApp.use(express.static(staticPath));
  expressApp.use(express.json({ limit: "10mb" }));

  expressApp.get("/ports", async (req, res) => {
    try {
      const ports = await SerialPort.list();
      res.json(
        ports.map((port) => ({
          path: port.path,
          manufacturer: port.manufacturer || "Unknown",
          serialNumber: port.serialNumber || "N/A",
          vendorId: port.vendorId || "N/A",
          productId: port.productId || "N/A",
        }))
      );
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  expressApp.get("/local-compile", (req, res) => {
    if (!fs.existsSync(inoFilePath)) {
      return res.status(400).json({ error: "No .ino file found to compile." });
    }

    exec("arduino-cli board list", (err, stdout, stderr) => {
      if (err) {
        return res.status(500).json({ error: "Board detection failed." });
      }

      let fqbn = "arduino:avr:uno";
      const lines = stdout.split("\n");

      for (const line of lines) {
        if (line.includes("arduino:avr:uno")) {
          fqbn = "arduino:avr:uno";
          break;
        } else if (line.includes("arduino:avr:mega")) {
          fqbn = "arduino:avr:mega";
          break;
        } else if (line.includes("arduino:avr:nano")) {
          fqbn = "arduino:avr:nano";
          break;
        }
      }

      const compileCmd = `arduino-cli compile --fqbn ${fqbn} --output-dir ${inoFolder} ${inoFolder}`;
      exec(compileCmd, (error, stdout, stderr) => {
        if (error) {
          return res.status(500).json({ error: stderr || error.message });
        }

        const files = fs.readdirSync(inoFolder);
        const hexFile = files.find((f) => f.endsWith(".hex"));
        if (!hexFile) {
          return res.status(500).json({ error: "HEX file not found after compilation." });
        }

        res.json({
          message: "Local compilation successful",
          fqbn,
          hexFileName: hexFile,
          hexFilePath: path.join(inoFolder, hexFile),
        });
      });
    });
  });

  expressApp.get("/compile", (req, res) => {
  if (!fs.existsSync(inoFilePath)) {
    return res.status(400).send("No .ino file found to compile.");
  }

  const fqbn = "arduino:avr:uno";
  const compileCmd = `arduino-cli compile --fqbn ${fqbn} --output-dir ${inoFolder} ${inoFolder}`;

  exec(compileCmd, (error, stdout, stderr) => {
    if (error) {
      console.error("Compile error:", stderr || error.message);
      return res.status(500).send("Compilation failed.");
    }

    const files = fs.readdirSync(inoFolder);
    const hexFile = files.find((f) => f.endsWith(".hex"));
    if (!hexFile) {
      return res.status(500).send("HEX file not found after compilation.");
    }

    const hexContent = fs.readFileSync(path.join(inoFolder, hexFile), "utf-8");
    res.setHeader("Content-Type", "text/plain");
    res.send(hexContent);
  });
});

  expressApp.listen(4000);
};

let portsMenuItems = [];

const updatePortsMenu = async () => {
  const ports = await SerialPort.list();

  portsMenuItems = ports.length
    ? ports.map((port) => ({
        label: `${port.path} (${port.manufacturer || "Unknown"})`,
        click: () => {
          dialog.showMessageBox({
            type: "info",
            title: "Port Info",
            message: `Path: ${port.path}\nManufacturer: ${port.manufacturer || "Unknown"}\nSerial Number: ${
              port.serialNumber || "N/A"
            }\nVendor ID: ${port.vendorId || "N/A"}\nProduct ID: ${port.productId || "N/A"}`,
          });
        },
      }))
    : [{ label: "No ports available", enabled: false }];

  portsMenuItems.push(
    { type: "separator" },
    { label: "Refresh Ports", click: updatePortsMenu },
    { label: "View Ports (JSON)", click: () => shell.openExternal("http://localhost:4000/ports") }
  );

  buildTrayMenu();
};

const buildTrayMenu = () => {
  const compileOption = fs.existsSync(inoFilePath)
    ? {
        label: "LocalCompile",
        click: () => {
          shell.openExternal("http://localhost:4000/local-compile");
        },
      }
    : null;

  const menuTemplate = [
    {
      label: "Ports",
      submenu: portsMenuItems,
    },
    {
        label: "Compile",
        click: () => {
          shell.openExternal("http://localhost:4000/compile");
        },
      },
    { type: "separator" },
    compileOption,
    { label: "Open ElectroBlocks", click: () => shell.openExternal("http://localhost:4000") },
    { type: "separator" },
    { label: "Quit", click: () => app.quit() },
  ].filter(Boolean);

  const contextMenu = Menu.buildFromTemplate(menuTemplate);
  tray.setContextMenu(contextMenu);
};

app.whenReady().then(() => {
  unzipBuildIfNeeded();

  tray = new Tray(path.join(__dirname, "icon.png"));
  tray.setToolTip("ElectroBlocks Tray App");
  tray.on("click", () => tray.popUpContextMenu());
  tray.on("right-click", () => tray.popUpContextMenu());

  startExpressServer();
  updatePortsMenu();
  startInoWatcher();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});