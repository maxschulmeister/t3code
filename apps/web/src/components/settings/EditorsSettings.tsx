import {
  DndContext,
  PointerSensor,
  closestCorners,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { CustomApplication, EditorId, EnvironmentId } from "@t3tools/contracts";
import { CheckIcon, GripVerticalIcon, PlusIcon, XIcon } from "lucide-react";
import { useCallback, useMemo } from "react";

import { useCustomApplications } from "../../customApplications";
import { editorPreferenceRef, useEditorPreferences } from "../../editorPreferences";
import { resolveEditorOptions } from "../../editorOptions";
import { isMacPlatform } from "../../lib/utils";
import { shellEnvironment } from "../../state/shell";
import { useAtomCommand } from "../../state/use-atom-command";
import { CustomApplicationIcon } from "../CustomApplicationIcon";
import { Button } from "../ui/button";
import { SettingsRow, SettingsSection } from "./settingsLayout";

function editorKey(editor: EditorId | CustomApplication): string {
  const ref = editorPreferenceRef(editor);
  return `${ref._tag}:${ref.id}`;
}

function SortableEditorRow({
  editor,
  label,
  Icon,
  application,
  isDefault,
  onDefault,
  onRemove,
}: {
  editor: EditorId | CustomApplication;
  label: string;
  Icon?: React.ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>;
  application?: CustomApplication;
  isDefault: boolean;
  onDefault: () => void;
  onRemove?: () => void;
}) {
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: editorKey(editor) });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`flex items-center gap-2 border-t border-border/60 px-3 py-2 first:border-t-0 ${
        isDragging ? "relative z-10 bg-card opacity-80" : ""
      }`}
    >
      <Button
        ref={setActivatorNodeRef}
        type="button"
        variant="ghost"
        size="icon-xs"
        className="cursor-grab text-muted-foreground active:cursor-grabbing"
        aria-label={`Reorder ${label}`}
        {...attributes}
        {...listeners}
      >
        <GripVerticalIcon aria-hidden="true" className="size-3.5" />
      </Button>
      {application ? (
        <CustomApplicationIcon
          application={application}
          className="size-4 shrink-0 text-muted-foreground"
        />
      ) : Icon ? (
        <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      ) : null}
      <button
        type="button"
        className="min-w-0 flex-1 truncate text-left text-sm"
        onClick={onDefault}
      >
        {label}
      </button>
      <Button
        type="button"
        variant={isDefault ? "secondary" : "ghost"}
        size="xs"
        className="min-w-20"
        onClick={onDefault}
        aria-label={`Make ${label} default`}
      >
        {isDefault ? <CheckIcon aria-hidden="true" className="size-3.5" /> : null}
        {isDefault ? "Default" : "Make default"}
      </Button>
      {onRemove ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={`Remove ${label}`}
          onClick={onRemove}
        >
          <XIcon aria-hidden="true" className="size-3.5" />
        </Button>
      ) : (
        <span className="w-7" aria-hidden />
      )}
    </div>
  );
}

export function EditorsSettings({
  environmentId,
  availableEditors,
}: {
  environmentId: EnvironmentId | null;
  availableEditors: ReadonlyArray<EditorId>;
}) {
  if (environmentId === null) {
    return (
      <SettingsSection title="Editors">
        <SettingsRow
          title="Open in editor"
          description="Connect an environment to manage editor order and default."
        />
      </SettingsSection>
    );
  }

  return (
    <ConnectedEditorsSettings environmentId={environmentId} availableEditors={availableEditors} />
  );
}

function ConnectedEditorsSettings({
  environmentId,
  availableEditors,
}: {
  environmentId: EnvironmentId;
  availableEditors: ReadonlyArray<EditorId>;
}) {
  const selectCustomApplication = useAtomCommand(
    shellEnvironment.selectCustomApplication,
    "choose application",
  );
  const { applications, addApplication, removeApplication } = useCustomApplications(environmentId);
  const { orderedEditors, defaultEditor, setDefaultEditor, setEditorOrder } = useEditorPreferences(
    environmentId,
    availableEditors,
    applications,
  );
  const options = useMemo(
    () => resolveEditorOptions(navigator.platform, availableEditors),
    [availableEditors],
  );
  const optionById = useMemo(
    () => new Map(options.map((option) => [option.value, option])),
    [options],
  );
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const collisionDetection = useCallback<CollisionDetection>((args) => {
    const collisions = pointerWithin(args);
    return collisions.length > 0 ? collisions : closestCorners(args);
  }, []);
  const canChooseApplication = isMacPlatform(navigator.platform);

  const chooseApplication = useCallback(async () => {
    const result = await selectCustomApplication({ environmentId, input: {} });
    if (result._tag === "Success" && result.value.application) {
      addApplication(result.value.application);
    }
  }, [addApplication, environmentId, selectCustomApplication]);

  const removeCustomApplication = useCallback(
    (application: CustomApplication) => {
      const isDefault = typeof defaultEditor !== "string" && defaultEditor?.id === application.id;
      removeApplication(application.id);
      if (isDefault) {
        setDefaultEditor(
          orderedEditors.find(
            (editor) => typeof editor === "string" || editor.id !== application.id,
          ) ?? null,
        );
      }
    },
    [defaultEditor, orderedEditors, removeApplication, setDefaultEditor],
  );

  const handleDragEnd = useCallback(
    ({ active, over }: DragEndEvent) => {
      if (!over || active.id === over.id) return;
      const from = orderedEditors.findIndex((editor) => editorKey(editor) === active.id);
      const to = orderedEditors.findIndex((editor) => editorKey(editor) === over.id);
      if (from < 0 || to < 0) return;
      const next = [...orderedEditors];
      const [moved] = next.splice(from, 1);
      if (!moved) return;
      next.splice(to, 0, moved);
      setEditorOrder(next);
    },
    [orderedEditors, setEditorOrder],
  );

  return (
    <SettingsSection
      title="Editors"
      headerAction={
        canChooseApplication ? (
          <Button size="xs" variant="ghost" onClick={() => void chooseApplication()}>
            <PlusIcon aria-hidden="true" />
            Choose app…
          </Button>
        ) : null
      }
    >
      <SettingsRow
        title="Open in editor"
        description="Drag editors into picker order. Choose explicit default for primary open actions."
      >
        <DndContext
          sensors={sensors}
          collisionDetection={collisionDetection}
          modifiers={[restrictToVerticalAxis]}
          onDragEnd={handleDragEnd}
        >
          <div className="mt-3 -mx-4 border-t border-border/60 sm:-mx-5">
            <SortableContext
              items={orderedEditors.map(editorKey)}
              strategy={verticalListSortingStrategy}
            >
              {orderedEditors.map((editor) => {
                const custom = typeof editor !== "string";
                const option = custom ? null : optionById.get(editor);
                if (!custom && !option) return null;
                const label = custom ? editor.name : option!.label;
                const Icon = custom ? undefined : option!.Icon;
                const isDefault =
                  typeof editor === "string"
                    ? editor === defaultEditor
                    : typeof defaultEditor !== "string" && defaultEditor?.id === editor.id;
                return (
                  <SortableEditorRow
                    key={editorKey(editor)}
                    editor={editor}
                    label={label}
                    {...(Icon ? { Icon } : { application: editor as CustomApplication })}
                    isDefault={isDefault}
                    onDefault={() => setDefaultEditor(editor)}
                    {...(custom ? { onRemove: () => removeCustomApplication(editor) } : {})}
                  />
                );
              })}
            </SortableContext>
            {orderedEditors.length === 0 ? (
              <p className="px-5 py-4 text-xs text-muted-foreground">No installed editors found.</p>
            ) : null}
          </div>
        </DndContext>
      </SettingsRow>
    </SettingsSection>
  );
}
