import { TopBar } from "@/components/shell/TopBar";
import { EmptyState } from "@/components/ui/primitives";

export function PagePlaceholder({ title, hint }: { title: string; hint?: string }) {
  return (
    <>
      <TopBar title={title} />
      <main style={{ flex: 1, padding: 20 }}>
        <EmptyState
          title={`${title} — under construction`}
          hint={hint ?? "This screen is being ported from the design prototype."}
        />
      </main>
    </>
  );
}
