"use client";

import { useActionState, useState, useTransition, type ChangeEvent } from "react";
import posthog from "posthog-js";
import { Alert, FormFeedback } from "@/components/ui/alert";
import { StatusDot } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Field, fieldProps } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import { setWidgetEnabled, updateWidgetConfig } from "./actions";

const MAX_ICON_BYTES = 5 * 1024 * 1024;

type IconType = "emoji" | "image";
type Shape = "circle" | "rounded" | "square";

/**
 * Snippet do widget (com botão de copiar) + personalização (cor, saudação,
 * ícone, formato, borda). O snippet em si nunca muda — tudo já vem embutido
 * no `widget.js` daquele tenant (gerado por deployTenantWidget). Salvar aqui
 * republica esse arquivo na CDN sozinho, sem precisar reinstalar nada.
 */
export function SnippetBox({
  tenantId,
  widgetEnabled,
  widgetColor,
  widgetGreeting,
  widgetIconType,
  widgetIconEmoji,
  widgetIconUrl,
  widgetShape,
  widgetBorderColor,
}: {
  tenantId: string;
  widgetEnabled: boolean;
  widgetColor: string;
  widgetGreeting: string;
  widgetIconType: string;
  widgetIconEmoji: string;
  widgetIconUrl: string | null;
  widgetShape: string;
  widgetBorderColor: string | null;
}) {
  const [copyError, setCopyError] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [state, formAction, pending] = useActionState(updateWidgetConfig, null);
  const [togglePending, startToggle] = useTransition();
  const pullZone = process.env.NEXT_PUBLIC_BUNNY_PULL_ZONE;

  const [iconType, setIconType] = useState<IconType>(
    widgetIconType === "image" ? "image" : "emoji",
  );
  const [shape, setShape] = useState<Shape>(
    widgetShape === "rounded" || widgetShape === "square" ? widgetShape : "circle",
  );
  const [hasBorder, setHasBorder] = useState(Boolean(widgetBorderColor));
  const [borderColor, setBorderColor] = useState(widgetBorderColor ?? "#1a1a1a");

  function handleIconFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file && file.size > MAX_ICON_BYTES) {
      setFileError(`"${file.name}" tem ${(file.size / (1024 * 1024)).toFixed(1)}MB — o máximo é 5MB.`);
      event.target.value = "";
      return;
    }
    setFileError(null);
  }

  if (!pullZone) {
    return (
      <Alert tone="warn">
        A CDN do widget ainda não está configurada nesta conta. Configure as variáveis BUNNY_*
        (veja o .env.example) para liberar o código de instalação.
      </Alert>
    );
  }

  const snippet = `<script src="https://${pullZone}/widget/${tenantId}/widget.js" defer></script>`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <StatusDot tone={widgetEnabled ? "success" : "neutral"}>
          {widgetEnabled ? "Botão ativo no seu site" : "Botão desativado"}
        </StatusDot>
        <Button
          type="button"
          variant={widgetEnabled ? "outline" : "default"}
          size="sm"
          loading={togglePending}
          loadingLabel={widgetEnabled ? "Desativando" : "Ativando"}
          onClick={() =>
            startToggle(async () => {
              posthog.capture("widget_enabled_toggled", { enabled: !widgetEnabled });
              await setWidgetEnabled(!widgetEnabled);
            })
          }
        >
          {widgetEnabled ? "Desativar botão" : "Ativar botão"}
        </Button>
      </div>

      {!widgetEnabled && (
        <Alert tone="warn" title="O botão ainda não aparece no seu site">
          O código abaixo já pode ser instalado, mas o botão só passa a aparecer depois que você
          ativar — quem visita o site conversa com o agente sem sair da página.
        </Alert>
      )}

      <div className="space-y-3">
        <pre className="overflow-x-auto rounded-control border border-white/10 bg-black/40 p-4 font-mono text-xs text-white/80">
          {snippet}
        </pre>
        <div className="flex flex-wrap items-center gap-3">
          <CopyButton value={snippet} label="Copiar código" onCopyError={setCopyError} />
          <span className="text-xs text-white/60">
            Não sabe onde colar? Copie e envie para quem cuida do seu site — é só colar antes do
            final da página.
          </span>
        </div>
        {copyError && <Alert tone="warn">{copyError}</Alert>}
      </div>

      <form action={formAction} className="space-y-5 border-t border-white/10 pt-4">
        <h4 className="font-mono text-micro uppercase tracking-[0.15em] text-white/60">
          Personalizar botão
        </h4>

        <input type="hidden" name="widgetIconType" value={iconType} />
        <input type="hidden" name="widgetShape" value={shape} />
        <input type="hidden" name="widgetBorderColor" value={hasBorder ? borderColor : ""} />

        <div className="flex flex-wrap gap-4">
          <Field label="Cor" htmlFor="widget-color" className="w-24">
            <Input
              {...fieldProps("widget-color")}
              type="color"
              name="widgetColor"
              defaultValue={widgetColor}
              className="h-10 w-full cursor-pointer p-1"
            />
          </Field>

          <Field label="Saudação inicial" htmlFor="widget-greeting" className="min-w-[220px] flex-1">
            <Input
              {...fieldProps("widget-greeting")}
              type="text"
              name="widgetGreeting"
              defaultValue={widgetGreeting}
              maxLength={200}
              placeholder="Olá! Como posso ajudar?"
            />
          </Field>
        </div>

        <Field label="Ícone" htmlFor="widget-icon-type-group">
          <div id="widget-icon-type-group" className="space-y-3">
            <SegmentedControl
              value={iconType}
              onSelect={setIconType}
              label="Tipo de ícone"
              options={[
                { value: "emoji", label: "Emoji" },
                { value: "image", label: "Imagem" },
              ]}
            />

            {iconType === "emoji" ? (
              <Input
                aria-label="Emoji do ícone"
                type="text"
                name="widgetIconEmoji"
                defaultValue={widgetIconEmoji}
                maxLength={8}
                className="w-20 text-center text-lg"
              />
            ) : (
              <div className="space-y-2">
                {widgetIconUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={widgetIconUrl}
                    alt=""
                    className="h-12 w-12 rounded-full border border-white/10 object-cover"
                  />
                )}
                <input
                  type="file"
                  name="widgetIconImage"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={handleIconFileChange}
                  className="w-full text-sm text-white/70 file:mr-3 file:rounded-control file:border-0 file:bg-white/10 file:px-3 file:py-2 file:text-sm file:text-white file:transition-colors hover:file:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris"
                />
                <p className="text-xs text-white/50">
                  PNG/JPG quadrado funciona melhor. Máximo 5MB.
                  {widgetIconUrl && " Deixe em branco para manter a imagem atual."}
                </p>
                <input type="hidden" name="widgetIconEmoji" value={widgetIconEmoji || "💬"} />
              </div>
            )}
          </div>
        </Field>

        {fileError && <Alert tone="warn">{fileError}</Alert>}

        <Field label="Formato do botão" htmlFor="widget-shape-group">
          <div id="widget-shape-group">
            <SegmentedControl
              value={shape}
              onSelect={setShape}
              label="Formato do botão"
              options={[
                { value: "circle", label: "Redondo" },
                { value: "rounded", label: "Arredondado" },
                { value: "square", label: "Quadrado" },
              ]}
            />
          </div>
        </Field>

        <Field label="Borda" htmlFor="widget-border-toggle">
          <div className="flex items-center gap-3">
            <Switch
              checked={hasBorder}
              onCheckedChange={setHasBorder}
              label="Adicionar borda ao botão"
            />
            {hasBorder && (
              <input
                aria-label="Cor da borda"
                type="color"
                value={borderColor}
                onChange={(e) => setBorderColor(e.target.value)}
                className="h-8 w-14 cursor-pointer rounded-control border border-white/20 bg-transparent p-0.5"
              />
            )}
          </div>
        </Field>

        <FormFeedback error={state?.error} info={state?.info} />

        <Button type="submit" variant="outline" size="sm" loading={pending} loadingLabel="Salvando">
          Salvar personalização
        </Button>
      </form>
    </div>
  );
}
