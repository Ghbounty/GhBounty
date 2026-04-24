import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

describe("logger", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("info writes to stdout with JSON line", async () => {
    const { log } = await import("../src/logger.js");
    log.info("hello", { foo: "bar" });
    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const [line] = stdoutSpy.mock.calls[0]!;
    const parsed = JSON.parse(String(line).trimEnd());
    expect(parsed.level).toBe("info");
    expect(parsed.msg).toBe("hello");
    expect(parsed.foo).toBe("bar");
    expect(typeof parsed.ts).toBe("string");
  });

  test("error writes to stderr", async () => {
    const { log } = await import("../src/logger.js");
    log.error("boom");
    expect(stderrSpy).toHaveBeenCalledTimes(1);
    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  test("debug below info threshold is dropped", async () => {
    const { log, setLogLevel } = await import("../src/logger.js");
    setLogLevel("info");
    log.debug("noise");
    expect(stdoutSpy).not.toHaveBeenCalled();
    setLogLevel("info"); // reset
  });

  test("setting level to debug emits debug", async () => {
    const { log, setLogLevel } = await import("../src/logger.js");
    setLogLevel("debug");
    log.debug("on");
    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    setLogLevel("info");
  });
});
