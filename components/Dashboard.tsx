"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { uploadFile, type Provider } from "@/lib/upload-client";
import {
  IconCheck,
  IconCloud,
  IconDatabase,
  IconDownload,
  IconEdit,
  IconFilm,
  IconFolder,
  IconImage,
  IconLink,
  IconLogout,
  IconPlay,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconTrash,
  IconUpload,
  IconX,
} from "./icons";

type Status = { r2: boolean; blob: boolean; defaultProvider: Provider | null; bucket: string | null };

type MediaItem = {
  id: string;
  provider: Provider;
  key: string;
  name: string;
  folder: string;
  mediaType: "video" | "image";
  size: number;
  uploadedAt: string;
  url: string;
  downloadUrl: string;
};

type Job = {
  id: string;
  name: string;
  size: number;
  provider: Provider;
  loaded: number;
  state: "uploading" | "done" | "error" | "cancelled";
  error?: string;
  controller: AbortController;
};

const PROVIDER_LABEL: Record<Provider, string> = { r2: "Cloudflare R2", blob: "Vercel Blob" };
const ACCEPT = "video/*,image/*,.mp4,.mov,.m4v,.webm,.mkv,.avi,.jpg,.jpeg,.png,.gif,.webp,.avif,.heic,.heif,.svg";

function formatBytes(n: number) {
  if (!n) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), u.length - 1);
  return `${(n / 1024 ** i).toFixed(i > 1 ? 1 : 0)} ${u[i]}`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

function formatDuration(s: number) {
  if (!isFinite(s)) return "";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60).toString().padStart(2, "0");
  return h ? `${h}:${m.toString().padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

export default function Dashboard({ status }: { status: Status }) {
  const router = useRouter();
  const [items, setItems] = useState<MediaItem[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [destination, setDestination] = useState<Provider | null>(status.defaultProvider);
  const [currentFolder, setCurrentFolder] = useState<"all" | "root" | string>("all");
  const [uploadFolder, setUploadFolder] = useState("");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | Provider>("all");
  const [category, setCategory] = useState<"all" | "video" | "image">("all");
  const [sort, setSort] = useState<"newest" | "oldest" | "largest" | "name">("newest");
  const [active, setActive] = useState<MediaItem | null>(null);
  const [dragging, setDragging] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameSaving, setRenameSaving] = useState(false);
  const [deletingFolder, setDeletingFolder] = useState<string | null>(null);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteSaving, setDeleteSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const configured = status.r2 || status.blob;

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/media", { cache: "no-store" });
      if (res.status === 401) return router.replace("/login");
      const data = await res.json();
      setItems(data.items ?? []);
      setFolders(data.folders ?? []);
      setErrors(data.errors ?? []);
    } catch {
      setErrors(["Could not load the media library."]);
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    if (configured) refresh();
    else setLoading(false);
  }, [configured, refresh]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const patchJob = (id: string, patch: Partial<Job>) =>
    setJobs((js) => js.map((j) => (j.id === id ? { ...j, ...patch } : j)));

  const startUploads = (files: FileList | File[]) => {
    if (!destination) return;
    const assets = Array.from(files).filter((f) =>
      f.type.startsWith("video/") || f.type.startsWith("image/") ||
      /\.(mp4|mov|m4v|webm|mkv|avi|jpe?g|png|gif|webp|avif|heic|heif|svg)$/i.test(f.name),
    );
    if (!assets.length) return setToast("Only image and video files can be uploaded");

    for (const file of assets) {
      const job: Job = {
        id: crypto.randomUUID(),
        name: file.name,
        size: file.size,
        provider: destination,
        loaded: 0,
        state: "uploading",
        controller: new AbortController(),
      };
      setJobs((js) => [job, ...js]);
      uploadFile(destination, file, uploadFolder, (loaded) => patchJob(job.id, { loaded }), job.controller.signal)
        .then(() => {
          patchJob(job.id, { state: "done", loaded: file.size });
          refresh();
        })
        .catch((e: Error) =>
          patchJob(job.id, e.name === "AbortError" ? { state: "cancelled" } : { state: "error", error: e.message }),
        );
    }
  };

  const remove = async (item: MediaItem) => {
    if (!confirm(`Delete “${item.name}” permanently from ${PROVIDER_LABEL[item.provider]}?`)) return;
    const res = await fetch("/api/media", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: item.provider, key: item.key }),
    });
    if (res.ok) {
      setItems((xs) => xs.filter((x) => x.id !== item.id));
      setActive(null);
      setToast("Video deleted");
    } else {
      setToast("Delete failed");
    }
  };

  const copyLink = async (item: MediaItem) => {
    await navigator.clipboard.writeText(item.url);
    setToast("Link copied to clipboard");
  };

  const createFolder = async () => {
    if (!destination) return setToast("Choose a storage destination first");
    const name = window.prompt("Folder name");
    if (!name?.trim()) return;
    const res = await fetch("/api/media", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "createFolder", provider: destination, name }),
    });
    const data = await res.json();
    if (!res.ok) return setToast(data.error ?? "Could not create folder");
    setFolders((xs) => [...new Set([...xs, data.folder])].sort());
    setCurrentFolder(data.folder);
    setUploadFolder(data.folder);
    setToast(`Folder “${data.folder}” created`);
  };

  const moveToFolder = async (item: MediaItem, folder: string) => {
    const res = await fetch("/api/media", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "move", provider: item.provider, key: item.key, folder }),
    });
    const data = await res.json();
    if (!res.ok) return setToast(data.error ?? "Could not move video");
    setToast(folder ? `Moved to ${folder}` : "Moved to Unfiled");
    await refresh();
  };

  const beginRename = (folder: string) => {
    setRenamingFolder(folder);
    setRenameValue(folder);
  };

  const cancelRename = () => {
    setRenamingFolder(null);
    setRenameValue("");
  };

  const renameFolder = async (from: string) => {
    if (!destination || renameSaving) return;
    const name = renameValue.trim();
    if (!name || name === from) return cancelRename();
    setRenameSaving(true);
    const res = await fetch("/api/media", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "renameFolder", provider: destination, from, to: name }),
    });
    const data = await res.json();
    if (!res.ok) {
      setRenameSaving(false);
      return setToast(data.error ?? "Could not rename folder");
    }
    if (currentFolder === from) setCurrentFolder(data.folder);
    if (uploadFolder === from) setUploadFolder(data.folder);
    cancelRename();
    setRenameSaving(false);
    setToast(`Folder renamed to “${data.folder}”`);
    await refresh();
  };

  const closeDeleteFolder = () => {
    if (deleteSaving) return;
    setDeletingFolder(null);
    setDeletePassword("");
  };

  const deleteFolder = async () => {
    if (!destination || !deletingFolder || !deletePassword || deleteSaving) return;
    setDeleteSaving(true);
    const res = await fetch("/api/media", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "deleteFolder", provider: destination, folder: deletingFolder, password: deletePassword }),
    });
    const data = await res.json();
    if (!res.ok) {
      setDeleteSaving(false);
      setDeletePassword("");
      return setToast(data.error ?? "Could not delete folder. Contact admin.");
    }
    if (currentFolder === deletingFolder) setCurrentFolder("root");
    if (uploadFolder === deletingFolder) setUploadFolder("");
    const removed = deletingFolder;
    setDeletingFolder(null);
    setDeletePassword("");
    setDeleteSaving(false);
    setToast(`Folder “${removed}” deleted. Its assets are now Unfiled.`);
    await refresh();
  };

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  };

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = items.filter((i) =>
      (filter === "all" || i.provider === filter) &&
      (category === "all" || i.mediaType === category) &&
      (currentFolder === "all" || (currentFolder === "root" ? !i.folder : i.folder === currentFolder)) &&
      (!q || i.name.toLowerCase().includes(q)),
    );
    const sorters: Record<typeof sort, (a: MediaItem, b: MediaItem) => number> = {
      newest: (a, b) => b.uploadedAt.localeCompare(a.uploadedAt),
      oldest: (a, b) => a.uploadedAt.localeCompare(b.uploadedAt),
      largest: (a, b) => b.size - a.size,
      name: (a, b) => a.name.localeCompare(b.name),
    };
    return list.sort(sorters[sort]);
  }, [items, query, filter, category, currentFolder, sort]);

  const totals = useMemo(() => {
    const by = (p: Provider) => items.filter((i) => i.provider === p);
    return {
      count: items.length,
      videos: items.filter((i) => i.mediaType === "video").length,
      images: items.filter((i) => i.mediaType === "image").length,
      size: items.reduce((a, b) => a + b.size, 0),
      r2: by("r2").reduce((a, b) => a + b.size, 0),
      blob: by("blob").reduce((a, b) => a + b.size, 0),
    };
  }, [items]);

  const activeJobs = jobs.filter((j) => j.state === "uploading").length;

  return (
    <div
      className="app"
      onDragOver={(e) => {
        e.preventDefault();
        if (destination) setDragging(true);
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        startUploads(e.dataTransfer.files);
      }}
    >
      <header className="topbar">
        <div className="topbar__inner">
          <a href="/" className="topbar__brand" aria-label="ILS Media Vault home">
            <img src="/ils-icon-white.png" alt="" width={34} height={34} />
            <span className="topbar__divider" />
            <span className="topbar__name">Media Vault</span>
          </a>
          <div className="topbar__status">
            <StatusChip on={status.r2} label="Cloudflare R2" icon={<IconCloud width={14} height={14} />} />
            <StatusChip on={status.blob} label="Vercel Blob" icon={<IconDatabase width={14} height={14} />} />
          </div>
          <button className="btn btn--ghost btn--sm" onClick={logout}>
            <IconLogout width={16} height={16} /> <span className="hide-sm">Sign out</span>
          </button>
        </div>
      </header>

      <main className="shell">
        <section className="hero">
          <div>
            <p className="eyebrow">ILS · Video Storage</p>
            <h1 className="hero__title">
              Media <em>Library</em>
            </h1>
            <p className="hero__lede">Upload, organise and preview ILS videos, images and social media assets from secure cloud storage.</p>
          </div>
          <dl className="stats">
            <Stat label="Assets" value={String(totals.count)} />
            <Stat label="Videos" value={String(totals.videos)} />
            <Stat label="Images" value={String(totals.images)} />
            <Stat label="Total stored" value={formatBytes(totals.size)} />
          </dl>
        </section>

        {!configured ? (
          <SetupNotice />
        ) : (
          <section className="upload">
            <button
              type="button"
              className={`dropzone ${dragging ? "dropzone--active" : ""}`}
              onClick={() => inputRef.current?.click()}
            >
              <span className="dropzone__icon"><IconUpload width={22} height={22} /></span>
              <span className="dropzone__title">Drop images or videos here, or <u>browse</u></span>
              <span className="dropzone__hint">Social images, JPG, PNG, MP4, MOV, WEBM · large files upload in parallel chunks</span>
              <input
                ref={inputRef}
                type="file"
                accept={ACCEPT}
                multiple
                hidden
                onChange={(e) => {
                  if (e.target.files) startUploads(e.target.files);
                  e.target.value = "";
                }}
              />
            </button>

            <div className="upload__side">
              <p className="label">Upload destination</p>
              <div className="segmented" role="radiogroup" aria-label="Upload destination">
                {(["r2", "blob"] as Provider[]).map((p) => (
                  <button
                    key={p}
                    role="radio"
                    aria-checked={destination === p}
                    disabled={!status[p]}
                    className={destination === p ? "is-active" : ""}
                    onClick={() => setDestination(p)}
                    title={status[p] ? undefined : `${PROVIDER_LABEL[p]} is not configured`}
                  >
                    {p === "r2" ? <IconCloud width={15} height={15} /> : <IconDatabase width={15} height={15} />}
                    {PROVIDER_LABEL[p]}
                  </button>
                ))}
              </div>
              <p className="upload__meta mono">
                {destination === "r2" ? `bucket · ${status.bucket}` : destination === "blob" ? "store · vercel blob" : "—"}
              </p>
              <div className="upload-folder">
                <label className="label" htmlFor="upload-folder">Upload folder</label>
                <select id="upload-folder" value={uploadFolder} onChange={(e) => setUploadFolder(e.target.value)}>
                  <option value="">Unfiled</option>
                  {folders.map((folder) => <option key={folder} value={folder}>{folder}</option>)}
                </select>
              </div>
            </div>

            {jobs.length > 0 && (
              <div className="queue">
                <div className="queue__head">
                  <span>{activeJobs ? `Uploading ${activeJobs} file${activeJobs > 1 ? "s" : ""}` : "Uploads"}</span>
                  {!activeJobs && (
                    <button className="link" onClick={() => setJobs([])}>Clear</button>
                  )}
                </div>
                {jobs.map((j) => {
                  const pct = j.size ? Math.round((j.loaded / j.size) * 100) : 0;
                  return (
                    <div key={j.id} className={`job job--${j.state}`}>
                      <IconFilm width={16} height={16} className="job__icon" />
                      <div className="job__body">
                        <div className="job__row">
                          <span className="job__name">{j.name}</span>
                          <span className="job__pct mono">
                            {j.state === "uploading" && `${pct}%`}
                            {j.state === "done" && <IconCheck width={15} height={15} />}
                            {j.state === "error" && "Failed"}
                            {j.state === "cancelled" && "Cancelled"}
                          </span>
                        </div>
                        <div className="bar"><span style={{ width: `${pct}%` }} /></div>
                        <div className="job__row job__sub mono">
                          <span>{j.error ?? `${formatBytes(j.loaded)} / ${formatBytes(j.size)} · ${PROVIDER_LABEL[j.provider]}`}</span>
                        </div>
                      </div>
                      {j.state === "uploading" && (
                        <button className="icon-btn" aria-label="Cancel upload" onClick={() => j.controller.abort()}>
                          <IconX width={15} height={15} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {configured && (
          <section className="library">
            <div className="folderbar" aria-label="Media folders">
              <div className="folderbar__list">
                <button className={currentFolder === "all" ? "is-active" : ""} onClick={() => setCurrentFolder("all")}>All assets</button>
                <button className={currentFolder === "root" ? "is-active" : ""} onClick={() => { setCurrentFolder("root"); setUploadFolder(""); }}>
                  <IconFolder width={15} height={15} /> Unfiled
                </button>
                {folders.map((folder) => (
                  <div key={folder} className={`folder-chip ${currentFolder === folder ? "is-active" : ""}`}>
                    {renamingFolder === folder ? (
                      <form className="folder-chip__edit" onSubmit={(e) => { e.preventDefault(); renameFolder(folder); }}>
                        <IconFolder width={15} height={15} />
                        <input
                          autoFocus
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Escape") cancelRename(); }}
                          aria-label={`New name for ${folder}`}
                          disabled={renameSaving}
                        />
                        <button type="submit" className="folder-chip__action folder-chip__save" aria-label="Save folder name" title="Save" disabled={renameSaving || !renameValue.trim()}>
                          <IconCheck width={15} height={15} />
                        </button>
                        <button type="button" className="folder-chip__action" onClick={cancelRename} aria-label="Cancel renaming" title="Cancel" disabled={renameSaving}>
                          <IconX width={15} height={15} />
                        </button>
                      </form>
                    ) : (
                      <>
                        <button className="folder-chip__select" onClick={() => { setCurrentFolder(folder); setUploadFolder(folder); }}>
                          <IconFolder width={15} height={15} /> <span>{folder}</span>
                        </button>
                        <button className="folder-chip__action" onClick={() => beginRename(folder)} aria-label={`Rename ${folder}`} title="Rename folder">
                          <IconEdit width={14} height={14} />
                        </button>
                        <button className="folder-chip__action folder-chip__delete" onClick={() => { setDeletingFolder(folder); setDeletePassword(""); }} aria-label={`Delete ${folder}`} title="Delete folder">
                          <IconTrash width={14} height={14} />
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </div>
              <div className="folderbar__actions">
                <button className="btn btn--ghost btn--sm" onClick={createFolder}>
                  <IconPlus width={15} height={15} /> New folder
                </button>
              </div>
            </div>
            <div className="toolbar">
              <div className="search">
                <IconSearch width={16} height={16} />
                <input placeholder="Search media assets" value={query} onChange={(e) => setQuery(e.target.value)} />
              </div>
              <div className="toolbar__right">
                <div className="pills category-pills" aria-label="Asset category">
                  {(["all", "video", "image"] as const).map((kind) => (
                    <button key={kind} className={category === kind ? "is-active" : ""} onClick={() => setCategory(kind)}>
                      {kind === "all" ? "All media" : kind === "video" ? "Videos" : "Images / Posts"}
                    </button>
                  ))}
                </div>
                <div className="pills">
                  {(["all", "r2", "blob"] as const).map((f) => (
                    <button key={f} className={filter === f ? "is-active" : ""} onClick={() => setFilter(f)}>
                      {f === "all" ? "All" : f === "r2" ? "R2" : "Blob"}
                    </button>
                  ))}
                </div>
                <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort">
                  <option value="newest">Newest</option>
                  <option value="oldest">Oldest</option>
                  <option value="largest">Largest</option>
                  <option value="name">Name</option>
                </select>
                <button className="icon-btn" onClick={refresh} aria-label="Refresh">
                  <IconRefresh width={16} height={16} className={loading ? "spin" : ""} />
                </button>
              </div>
            </div>

            {errors.map((e) => (
              <p key={e} className="alert">{e}</p>
            ))}

            {loading && !items.length ? (
              <div className="grid">
                {Array.from({ length: 6 }, (_, i) => <div key={i} className="card card--skeleton" />)}
              </div>
            ) : visible.length ? (
              <div className="grid">
                {visible.map((item) => (
                  <MediaCard
                    key={item.id}
                    item={item}
                    folders={folders}
                    onOpen={() => setActive(item)}
                    onCopy={() => copyLink(item)}
                    onMove={(folder) => moveToFolder(item, folder)}
                    onDelete={() => remove(item)}
                  />
                ))}
              </div>
            ) : (
              <div className="empty">
                <IconFilm width={28} height={28} />
                <p>{items.length ? "No assets match these filters." : "No media yet — upload your first image or video above."}</p>
              </div>
            )}
          </section>
        )}
      </main>

      <footer className="footer">
        <img src="/ils-logo-white.png" alt="ILS" height={22} />
        <span>© {new Date().getFullYear()} ILS · Internal media platform</span>
      </footer>

      {active && (
        <MediaModal item={active} onClose={() => setActive(null)} onCopy={() => copyLink(active)} onDelete={() => remove(active)} />
      )}
      {deletingFolder && (
        <div className="modal" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) closeDeleteFolder(); }}>
          <form className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-folder-title" onSubmit={(e) => { e.preventDefault(); deleteFolder(); }}>
            <div className="confirm-dialog__icon"><IconTrash width={22} height={22} /></div>
            <div>
              <p className="eyebrow">Protected action</p>
              <h2 id="delete-folder-title">Delete “{deletingFolder}”?</h2>
              <p>The folder will be removed, but its images and videos will be kept safely in <strong>Unfiled</strong>.</p>
            </div>
            <label className="confirm-dialog__field">
              <span>Deletion password</span>
              <input
                autoFocus
                type="password"
                value={deletePassword}
                onChange={(e) => setDeletePassword(e.target.value)}
                placeholder="Enter password"
                autoComplete="off"
                disabled={deleteSaving}
              />
            </label>
            <p className="confirm-dialog__note">Don’t have the password? Contact admin.</p>
            <div className="confirm-dialog__actions">
              <button type="button" className="btn btn--ghost" onClick={closeDeleteFolder} disabled={deleteSaving}>Cancel</button>
              <button type="submit" className="btn btn--danger" disabled={deleteSaving || !deletePassword}>
                <IconTrash width={16} height={16} /> {deleteSaving ? "Deleting…" : "Delete folder"}
              </button>
            </div>
          </form>
        </div>
      )}
      {dragging && <div className="drop-overlay"><IconUpload width={32} height={32} /> Drop to upload to {destination && PROVIDER_LABEL[destination]}</div>}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

function StatusChip({ on, label, icon }: { on: boolean; label: string; icon: React.ReactNode }) {
  return (
    <span className={`chip ${on ? "chip--on" : "chip--off"}`} title={on ? "Connected" : "Not configured"}>
      <span className="chip__dot" />
      {icon}
      <span className="hide-sm">{label}</span>
    </span>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function MediaCard({ item, folders, onOpen, onCopy, onMove, onDelete }: {
  item: MediaItem;
  folders: string[];
  onOpen: () => void;
  onCopy: () => void;
  onMove: (folder: string) => void;
  onDelete: () => void;
}) {
  const [duration, setDuration] = useState<number | null>(null);
  const [ready, setReady] = useState(false);
  const ref = useRef<HTMLVideoElement>(null);

  return (
    <article className="card">
      <button
        className="card__media"
        onClick={onOpen}
        onMouseEnter={() => item.mediaType === "video" && ref.current?.play().catch(() => {})}
        onMouseLeave={() => {
          if (ref.current) {
            ref.current.pause();
            ref.current.currentTime = 0.5;
          }
        }}
        aria-label={`${item.mediaType === "video" ? "Play" : "View"} ${item.name}`}
      >
        <span className="card__placeholder">{item.mediaType === "video" ? <IconFilm width={26} height={26} /> : <IconImage width={28} height={28} />}</span>
        {item.mediaType === "video" ? (
          <>
            <video
              ref={ref}
              className={ready ? "is-ready" : ""}
              onLoadedData={() => setReady(true)}
              src={`${item.url}#t=0.5`}
              muted
              playsInline
              preload="metadata"
              onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
            />
            <span className="card__play"><IconPlay width={20} height={20} /></span>
            {duration !== null && <span className="card__duration mono">{formatDuration(duration)}</span>}
          </>
        ) : (
          <img className="card__image" src={item.url} alt="" onLoad={() => setReady(true)} />
        )}
        <span className="badge badge--type">{item.mediaType === "video" ? "Video" : "Image"}</span>
        <span className={`badge badge--${item.provider}`}>{item.provider === "r2" ? "R2" : "Blob"}</span>
      </button>
      <div className="card__body">
        <h3 className="card__title" title={item.name}>{item.name}</h3>
        <p className="card__meta mono">
          {formatBytes(item.size)} · {formatDate(item.uploadedAt)}
        </p>
        {item.folder && <p className="card__folder"><IconFolder width={13} height={13} /> {item.folder}</p>}
      </div>
      <div className="card__actions">
        <select className="card__folder-select" value={item.folder} onChange={(e) => onMove(e.target.value)} aria-label={`Move ${item.name} to folder`}>
          <option value="">Unfiled</option>
          {folders.map((folder) => <option key={folder} value={folder}>{folder}</option>)}
        </select>
        <button className="icon-btn" onClick={onCopy} aria-label="Copy link" title="Copy link"><IconLink width={15} height={15} /></button>
        <a className="icon-btn" href={item.downloadUrl} aria-label="Download" title="Download"><IconDownload width={15} height={15} /></a>
        <button className="icon-btn icon-btn--danger" onClick={onDelete} aria-label="Delete" title="Delete"><IconTrash width={15} height={15} /></button>
      </div>
    </article>
  );
}

function MediaModal({ item, onClose, onCopy, onDelete }: { item: MediaItem; onClose: () => void; onCopy: () => void; onDelete: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={item.name} onClick={onClose}>
      <div className="modal__panel" onClick={(e) => e.stopPropagation()}>
        {item.mediaType === "video" ? (
          <video src={item.url} controls autoPlay playsInline className="modal__video" />
        ) : (
          <div className="modal__image-wrap"><img src={item.url} alt={item.name} className="modal__image" /></div>
        )}
        <div className="modal__bar">
          <div className="modal__info">
            <h2>{item.name}</h2>
            <p className="mono">
              {item.mediaType === "video" ? "Video" : "Image / Social post"} · {PROVIDER_LABEL[item.provider]} · {formatBytes(item.size)} · {formatDate(item.uploadedAt)}
            </p>
          </div>
          <div className="modal__actions">
            <button className="btn btn--ghost btn--sm" onClick={onCopy}><IconLink width={15} height={15} /> Copy link</button>
            <a className="btn btn--ghost btn--sm" href={item.downloadUrl}><IconDownload width={15} height={15} /> Download</a>
            <button className="btn btn--danger btn--sm" onClick={onDelete}><IconTrash width={15} height={15} /> Delete</button>
          </div>
        </div>
        <button className="modal__close icon-btn" onClick={onClose} aria-label="Close"><IconX /></button>
      </div>
    </div>
  );
}

function SetupNotice() {
  return (
    <section className="setup">
      <h2>Connect storage to start uploading</h2>
      <p>No storage provider is configured yet. Add the environment variables in Vercel → Project → Settings → Environment Variables, then redeploy.</p>
      <div className="setup__grid">
        <div>
          <h3><IconCloud width={16} height={16} /> Cloudflare R2</h3>
          <code>R2_ACCOUNT_ID · R2_ACCESS_KEY_ID · R2_SECRET_ACCESS_KEY · R2_BUCKET</code>
        </div>
        <div>
          <h3><IconDatabase width={16} height={16} /> Vercel Blob</h3>
          <code>Storage → Create Blob store → Connect (adds BLOB_READ_WRITE_TOKEN)</code>
        </div>
      </div>
    </section>
  );
}
