import type { CustomApplication } from "@t3tools/contracts";
import { AppWindowIcon } from "lucide-react";

export function CustomApplicationIcon({
  application,
  className,
}: {
  application: CustomApplication;
  className?: string;
}) {
  return application.iconDataUrl ? (
    <img src={application.iconDataUrl} alt="" aria-hidden="true" className={className} />
  ) : (
    <AppWindowIcon aria-hidden="true" className={className} />
  );
}
