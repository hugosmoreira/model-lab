import { TopBar } from "@/components/shell/TopBar";
import { BenchmarkPacksLibrary } from "@/components/benchmarks/BenchmarkPacksLibrary";
import { fixtures } from "@/lib/data";

export default function BenchmarkPacksPage() {
  return (
    <>
      <TopBar title="Benchmark Packs" />
      <BenchmarkPacksLibrary packs={fixtures.benchmarkPacks} />
    </>
  );
}
