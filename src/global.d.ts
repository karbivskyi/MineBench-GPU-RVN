declare module "recharts";

interface Window {
  electron: {
    invoke: (channel: string, ...args: any[]) => Promise<any>;
  };
}
