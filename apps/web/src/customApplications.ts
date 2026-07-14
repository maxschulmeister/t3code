import type { CustomApplication } from "@t3tools/contracts";
import { CustomApplication as CustomApplicationSchema } from "@t3tools/contracts";
import { useCallback } from "react";
import * as Schema from "effect/Schema";

import { getLocalStorageItem, setLocalStorageItem, useLocalStorage } from "./hooks/useLocalStorage";

const CustomApplications = Schema.Array(CustomApplicationSchema);

export function customApplicationsStorageKey(environmentId: string): string {
  return `t3code:custom-applications:${environmentId}:v1`;
}

export function readCustomApplications(environmentId: string): ReadonlyArray<CustomApplication> {
  return getLocalStorageItem(customApplicationsStorageKey(environmentId), CustomApplications) ?? [];
}

function writeCustomApplications(
  environmentId: string,
  applications: ReadonlyArray<CustomApplication>,
): void {
  setLocalStorageItem(
    customApplicationsStorageKey(environmentId),
    applications,
    CustomApplications,
  );
}

export function addCustomApplication(environmentId: string, application: CustomApplication): void {
  const applications = readCustomApplications(environmentId);
  writeCustomApplications(environmentId, [
    ...applications.filter((candidate) => candidate.id !== application.id),
    application,
  ]);
}

export function removeCustomApplication(environmentId: string, applicationId: string): void {
  writeCustomApplications(
    environmentId,
    readCustomApplications(environmentId).filter((application) => application.id !== applicationId),
  );
}

export function useCustomApplications(environmentId: string) {
  const [applications, setApplications] = useLocalStorage(
    customApplicationsStorageKey(environmentId),
    [],
    CustomApplications,
  );

  const addApplication = useCallback(
    (application: CustomApplication) => {
      setApplications((current) => [
        ...current.filter((candidate) => candidate.id !== application.id),
        application,
      ]);
    },
    [setApplications],
  );

  const removeApplication = useCallback(
    (applicationId: string) => {
      setApplications((current) =>
        current.filter((application) => application.id !== applicationId),
      );
    },
    [setApplications],
  );

  return { applications, addApplication, removeApplication };
}
