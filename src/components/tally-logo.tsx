import Image from "next/image";
export function TallyLogo({
  className = "h-8 w-[33px] shrink-0 dark:rounded-md dark:bg-white",
}: {
  className?: string;
}) {
  return (
    <Image
      src="/tally-t-icon.svg"
      alt=""
      width={33}
      height={32}
      className={className}
    />
  );
}
