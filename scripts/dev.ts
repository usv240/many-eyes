import { spawn } from "node:child_process";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const children = ["server", "overlay"].map((workspace) =>
  spawn(npm, ["run", "dev", "--workspace", workspace], { stdio: "inherit" }),
);

for (const child of children) {
  child.on("exit", (code: number | null) => {
    for (const running of children) running.kill();
    process.exit(code ?? 1);
  });
}
