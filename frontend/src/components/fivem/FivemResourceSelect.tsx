import { Check, Search, X } from "lucide-react";
import { useMemo, useState } from "react";

export type FivemResourceOption = {
  color?: number;
  disabled?: boolean;
  id: string;
  name: string;
};

export function FivemResourceSelect({
  disabled,
  label,
  onChange,
  options,
  placeholder = "Nao configurado",
  prefix = "",
  value
}: {
  disabled: boolean;
  label: string;
  onChange: (value: string | null) => void;
  options: FivemResourceOption[];
  placeholder?: string;
  prefix?: string;
  value: string | null;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => filterOptions(options, query, value ? [value] : []), [options, query, value]);
  const selected = useMemo(() => options.find((option) => option.id === value) ?? null, [options, value]);

  return (
    <div className="grid gap-2 text-xs font-medium text-zinc-400">
      <div className="flex items-center justify-between gap-3">
        <span>{label}</span>
        <span className="text-[11px] text-zinc-600">{options.length} opcao(oes)</span>
      </div>
      {selected ? (
        <div className="flex min-h-9 items-center gap-2 rounded-lg border border-zinc-800 bg-black/40 px-3 text-sm text-zinc-200">
          {selected.color !== undefined ? <ColorDot color={selected.color} /> : null}
          <span className="min-w-0 flex-1 truncate">{prefix}{selected.name}</span>
          <span className="hidden shrink-0 text-[11px] text-zinc-600 sm:inline">{shortId(selected.id)}</span>
          <button
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-zinc-500 transition hover:bg-zinc-900 hover:text-white disabled:pointer-events-none disabled:opacity-40"
            disabled={disabled}
            onClick={() => onChange(null)}
            title="Limpar selecao"
            type="button"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}
      {options.length > 8 ? <SearchInput disabled={disabled} onChange={setQuery} value={query} /> : null}
      <select className="h-11 w-full rounded-lg border border-zinc-800 bg-[#09090b] px-3 text-sm text-zinc-100 outline-none transition focus:border-emerald-500/60 disabled:opacity-60" disabled={disabled} onChange={(event) => onChange(event.target.value || null)} value={value ?? ""}>
        <option value="">{placeholder}</option>
        {filtered.map((option) => <option disabled={option.disabled} key={option.id} value={option.id}>{prefix}{option.name}</option>)}
      </select>
      {query && !filtered.length ? <p className="text-xs text-zinc-500">Nenhum resultado para essa busca.</p> : null}
    </div>
  );
}

export function FivemResourceMultiSelect({ disabled, label, onChange, options, prefix = "", values }: {
  disabled: boolean;
  label: string;
  onChange: (values: string[]) => void;
  options: FivemResourceOption[];
  prefix?: string;
  values: string[];
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => filterOptions(options, query, values), [options, query, values]);
  const selectedOptions = useMemo(
    () => values.map((id) => options.find((option) => option.id === id) ?? { id, name: id }).filter(Boolean),
    [options, values]
  );
  const availableIds = filtered.filter((option) => !option.disabled).map((option) => option.id);
  const allVisibleSelected = availableIds.length > 0 && availableIds.every((id) => values.includes(id));

  function toggle(id: string) {
    onChange(values.includes(id) ? values.filter((value) => value !== id) : [...new Set([...values, id])]);
  }

  function toggleVisible() {
    onChange(allVisibleSelected
      ? values.filter((id) => !availableIds.includes(id))
      : [...new Set([...values, ...availableIds])]);
  }

  function remove(id: string) {
    onChange(values.filter((value) => value !== id));
  }

  return (
    <fieldset className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3 disabled:opacity-60" disabled={disabled}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <legend className="text-xs font-medium text-zinc-300">{label} <span className="text-zinc-500">({values.length}/{options.length})</span></legend>
        <div className="flex shrink-0 items-center gap-3">
          <button className="text-xs text-zinc-400 hover:text-white disabled:opacity-50" disabled={!values.length || disabled} onClick={() => onChange([])} type="button">Limpar</button>
          <button className="text-xs text-emerald-300 hover:text-emerald-200 disabled:opacity-50" disabled={!availableIds.length || disabled} onClick={toggleVisible} type="button">{allVisibleSelected ? "Desmarcar visiveis" : "Selecionar visiveis"}</button>
        </div>
      </div>
      {selectedOptions.length ? (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {selectedOptions.slice(0, 12).map((option) => (
            <span className="inline-flex max-w-full items-center gap-1 rounded-md border border-zinc-800 bg-black/40 px-2 py-1 text-xs text-zinc-200" key={option.id}>
              {"color" in option && option.color !== undefined ? <ColorDot color={option.color} /> : null}
              <span className="max-w-40 truncate">{prefix}{option.name}</span>
              <button
                className="text-zinc-500 transition hover:text-white disabled:pointer-events-none"
                disabled={disabled}
                onClick={() => remove(option.id)}
                title="Remover"
                type="button"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          {selectedOptions.length > 12 ? <span className="rounded-md border border-zinc-800 px-2 py-1 text-xs text-zinc-500">+{selectedOptions.length - 12}</span> : null}
        </div>
      ) : null}
      <SearchInput disabled={disabled} onChange={setQuery} value={query} />
      <div className="discord-scrollbar mt-2 max-h-44 space-y-1 overflow-y-auto">
        {filtered.length ? filtered.map((option) => (
          <label className={`flex min-h-9 items-center gap-2 rounded-md px-2 text-sm ${option.disabled ? "cursor-not-allowed opacity-45" : "cursor-pointer text-zinc-300 hover:bg-zinc-900"}`} key={option.id}>
            <input checked={values.includes(option.id)} disabled={disabled || option.disabled} onChange={() => toggle(option.id)} type="checkbox" />
            {option.color !== undefined ? <ColorDot color={option.color} /> : null}
            <span className="min-w-0 flex-1 truncate">{prefix}{option.name}</span>
            {values.includes(option.id) ? <Check className="h-3.5 w-3.5 shrink-0 text-emerald-300" /> : <span className="hidden shrink-0 text-[11px] text-zinc-600 sm:inline">{shortId(option.id)}</span>}
          </label>
        )) : <p className="px-2 py-4 text-center text-xs text-zinc-500">Nenhum resultado.</p>}
      </div>
    </fieldset>
  );
}

function SearchInput({ disabled, onChange, value }: { disabled: boolean; onChange: (value: string) => void; value: string }) {
  return <div className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-zinc-500" /><input className="h-9 w-full rounded-md border border-zinc-800 bg-black pl-9 pr-9 text-xs text-zinc-200 outline-none focus:border-emerald-500/50" disabled={disabled} onChange={(event) => onChange(event.target.value)} placeholder="Buscar por nome ou ID..." value={value} />{value ? <button className="absolute right-2 top-2 text-zinc-500 hover:text-white" onClick={() => onChange("")} type="button"><X className="h-4 w-4" /></button> : null}</div>;
}

function filterOptions(options: FivemResourceOption[], query: string, selectedIds: string[]) {
  const normalized = query.trim().toLocaleLowerCase("pt-BR");
  if (!normalized) return options;
  return options.filter((option) => selectedIds.includes(option.id) || option.name.toLocaleLowerCase("pt-BR").includes(normalized) || option.id.includes(normalized));
}

function ColorDot({ color }: { color: number }) {
  return <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color ? `#${color.toString(16).padStart(6, "0")}` : "#71717a" }} />;
}

function shortId(id: string) {
  return id.length > 10 ? `${id.slice(0, 4)}...${id.slice(-4)}` : id;
}
