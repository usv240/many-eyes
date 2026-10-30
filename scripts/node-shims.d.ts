declare module "node:child_process" {
  interface ChildProcess {
    kill(): boolean;
    on(event: "exit", listener: (code: number | null) => void): this;
  }
  export function spawn(command: string, args: string[], options: { stdio: "inherit" }): ChildProcess;
}

declare const process: {
  platform: string;
  exit(code?: number): never;
};
