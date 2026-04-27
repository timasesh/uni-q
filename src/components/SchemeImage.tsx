import { useEffect, useMemo, useState } from "react";
import { schemeImagePathsForWindow, schemeImagePathsGeneral } from "../lib/deskWindow";

type Props = {
  /** null/undefined -> general */
  windowNumber?: number | null;
  className?: string;
  alt?: string;
};

export default function SchemeImage({ windowNumber, className, alt = "" }: Props) {
  const paths = useMemo(() => {
    if (windowNumber != null) return schemeImagePathsForWindow(windowNumber);
    return schemeImagePathsGeneral();
  }, [windowNumber]);

  const [src, setSrc] = useState(paths.webp);

  // If props change (windowNumber), reset to webp first.
  useEffect(() => {
    setSrc(paths.webp);
  }, [paths.webp]);

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      onError={() => {
        if (src === paths.webp) setSrc(paths.png);
      }}
    />
  );
}

