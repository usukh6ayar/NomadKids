import type { ReactNode } from "react";
import { Code2 } from "lucide-react";

/** Display every returned key without making a raw JSON block the primary view. */
export function EsisResponseValues({ response }: { response: Record<string, unknown> }) {
  const entries = Object.entries(response);
  return entries.length > 0 ? (
    <ResponseFields entries={entries} />
  ) : (
    <p className="rounded-control bg-canvas px-3 py-4 text-caption text-muted">
      Хариунд нэмэлт утга ирээгүй.
    </p>
  );
}

function ResponseFields({ entries }: { entries: [string, unknown][] }) {
  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      {entries.map(([key, value]) => (
        <div key={key} className="min-w-0 rounded-control border border-border-soft bg-surface p-3">
          <dt className="break-all font-mono text-caption text-muted">{key}</dt>
          <dd className="mt-1 min-w-0 break-words text-body font-medium text-ink">
            <ResponseValue value={value} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function ResponseValue({ value }: { value: unknown }): ReactNode {
  if (value === null || value === undefined || value === "") {
    return <span className="font-normal text-faint">Хоосон</span>;
  }
  if (Array.isArray(value)) {
    return value.length ? (
      <ol className="mt-2 flex flex-col gap-2">
        {value.map((item, index) => (
          <li key={index} className="rounded-control bg-canvas p-2">
            <span className="mr-2 text-caption font-medium text-muted">{index + 1}.</span>
            <ResponseValue value={item} />
          </li>
        ))}
      </ol>
    ) : (
      <span className="font-normal text-faint">Хоосон жагсаалт</span>
    );
  }
  if (typeof value === "object") {
    return <ResponseFields entries={Object.entries(value)} />;
  }
  return String(value);
}

/** Keep the exact envelope available for troubleshooting, without leading with it. */
export function EsisRawResponse({ response, note }: { response: unknown; note?: string }) {
  return (
    <details className="group min-w-0 rounded-row border border-border-soft bg-canvas">
      <summary className="flex min-h-11 cursor-pointer items-center gap-2 px-4 py-2 text-caption font-semibold text-muted hover:text-ink">
        <Code2 size={16} aria-hidden />
        Техникийн хариу харах
      </summary>
      <div className="border-t border-border-soft px-4 py-3">
        {note ? <p className="mb-3 text-caption text-muted">{note}</p> : null}
        <pre className="max-h-[360px] overflow-auto rounded-control bg-ink p-4 text-caption leading-6 text-white">
          <code>{JSON.stringify(response, null, 2)}</code>
        </pre>
      </div>
    </details>
  );
}
