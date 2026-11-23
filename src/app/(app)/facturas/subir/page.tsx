import { requireUser } from "@/lib/auth/session";
import { providerStatus } from "@/lib/extraction";
import { PageHeader } from "@/components/ui";
import { Uploader } from "./uploader";

export const metadata = { title: "Subir factura" };

export default async function UploadPage() {
  await requireUser("editor");
  const provider = await providerStatus();
  return (
    <>
      <PageHeader title="Subir factura" subtitle="Haz una foto, elige imágenes o sube un PDF. Revisarás los datos antes de guardarlos." />
      <Uploader provider={{ ready: provider.ready, reason: provider.reason, label: provider.label }} />
    </>
  );
}
