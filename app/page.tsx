import Dashboard from "@/components/Dashboard";
import { storageStatus } from "@/lib/storage";

export const dynamic = "force-dynamic";

export default function Home() {
  const status = storageStatus();
  return <Dashboard status={{ r2: status.r2, blob: status.blob, defaultProvider: status.defaultProvider, bucket: status.bucket }} />;
}
