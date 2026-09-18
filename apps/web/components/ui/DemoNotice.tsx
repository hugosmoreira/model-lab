import { Callout } from "./primitives";

export function DemoNotice({ demo }: { demo: boolean }) {
  return demo ? (
    <Callout variant="note" style={{ margin: "12px 20px" }}>
      Illustrative demo data — a seeded example, not a benchmark performed on this instance.
    </Callout>
  ) : null;
}
