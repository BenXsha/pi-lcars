import { ICONS, type IconName } from "../icons";

type Props = {
  name: IconName;
  size?: number;
  /** accessible label; when omitted the icon is decorative */
  title?: string;
  class?: string;
};

export function Icon({ name, size = 16, title, class: cls }: Props) {
  return (
    <span
      class={`icon ${cls ?? ""}`}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      title={title}
    >
      <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" dangerouslySetInnerHTML={{ __html: ICONS[name] }} />
    </span>
  );
}

export type { IconName };
