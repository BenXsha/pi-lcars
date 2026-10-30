/**
 * Console mark: the supplied SVG, drawn with currentColor so it can sit on the
 * orange cap (black, like the rest of the cap type) or anywhere else later.
 */
const D =
  "M58.5,99Q30.5,118,0,171Q18.575998,0,62.435997,0Q106.296,0,129,134.89442Q86.5,80,58.5,99ZM69.416664,25.853451L65.5,16L61.583336,25.853451L51,29.5L61.583336,33.146553L65.5,43L69.416664,33.146549L80,29.5L69.416664,25.853451ZM64,86L55,59.5L59.5,46L64,46L64,86ZM67,86L76,59.5L71.5,46L67,46L67,86Z";

export function Logo({ size = 56, class: cls, title = "pi" }: { size?: number; class?: string; title?: string }) {
  const w = Math.round((size * 129) / 171);
  return (
    <svg
      class={`logo ${cls ?? ""}`}
      width={w}
      height={size}
      viewBox="0 0 129 171"
      fill="none"
      role="img"
      aria-label={title}
    >
      <path d={D} fill="currentColor" fill-rule="evenodd" />
    </svg>
  );
}
