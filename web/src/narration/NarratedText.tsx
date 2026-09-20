import type { HTMLAttributes, ReactNode } from "react";
import { NarrationButton } from "./NarrationButton";

type NarratedTextProps = HTMLAttributes<HTMLParagraphElement> & {
  children: ReactNode;
  narration?: string;
};

/** A paragraph with a nearby, independently controllable Grok narration button. */
export function NarratedText({ children, narration, className, ...props }: NarratedTextProps) {
  const text = narration ?? (typeof children === "string" ? children : undefined);
  return (
    <div className="narrated-text">
      <p className={className} {...props}>{children}</p>
      {text && <NarrationButton text={text} />}
    </div>
  );
}
