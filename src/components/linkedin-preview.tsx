import { Icon } from "./ui";

/** A LinkedIn-style card so drafts are judged the way readers will see them. */
export function LinkedInPreview({
  name,
  headline,
  photoUrl,
  text,
  images = [],
  when = "Scheduled",
}: {
  name: string;
  headline?: string;
  photoUrl?: string | null;
  text: string;
  images?: { id: string; url: string }[];
  when?: string;
}) {
  return (
    <article className="card overflow-hidden">
      <div className="flex items-center gap-3 px-5 pt-5">
        {photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photoUrl} alt="" className="h-12 w-12 rounded-full object-cover" />
        ) : (
          <span className="grid h-12 w-12 place-items-center rounded-full bg-blush-100 text-[16px] font-bold text-red-text">
            {name.replace(/^Dr\.?\s+/i, "").slice(0, 1)}
          </span>
        )}
        <div className="min-w-0 leading-tight">
          <p className="truncate text-[14px] font-semibold text-ink">{name}</p>
          {headline && <p className="truncate text-[12px] text-muted">{headline}</p>}
          <p className="flex items-center gap-1 text-[12px] text-muted">
            {when} · <Icon name="globe-hemisphere-east" size={12} className="text-muted" />
          </p>
        </div>
      </div>
      <div className="px-5 py-4 text-[14px] leading-relaxed whitespace-pre-wrap text-ink">{text}</div>
      {images.length > 0 && (
        <div className={images.length === 1 ? "" : "grid grid-cols-2 gap-0.5"}>
          {images.map((im) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={im.id} src={im.url} alt="" className="aspect-video w-full object-cover" />
          ))}
        </div>
      )}
    </article>
  );
}
