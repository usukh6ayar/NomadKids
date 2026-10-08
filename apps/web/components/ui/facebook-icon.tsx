import Image from "next/image";

/**
 * Facebook's mark, for the contact links — lucide ships no brand marks, and a
 * hand-written `<svg>` is what `tokens.test.tsx` forbids outside the charts.
 * So it is a file, in Facebook's own blue.
 */
export function FacebookIcon({ className }: { className?: string }) {
  return (
    <Image
      src="/icons/facebook.svg"
      alt=""
      width={16}
      height={16}
      unoptimized
      className={className}
    />
  );
}
