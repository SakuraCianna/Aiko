import { describe, expect, it, vi } from "vitest";
import {
  createCurrentKnowledgeProvider,
  detectCurrentKnowledgeIntent,
  formatCurrentKnowledgeContext
} from "../../src/main/agent/knowledge/currentKnowledgeProvider";

describe("detectCurrentKnowledgeIntent", () => {
  it("only detects Open-Meteo weather as a fixed current-knowledge request", () => {
    expect(detectCurrentKnowledgeIntent("查一下北京今天的天气")).toMatchObject({
      kind: "weather",
      location: "北京"
    });
    expect(detectCurrentKnowledgeIntent("历史上的今天发生了什么")).toBeNull();
    expect(detectCurrentKnowledgeIntent("美元兑人民币汇率是多少")).toBeNull();
    expect(detectCurrentKnowledgeIntent("今年中国节假日")).toBeNull();
    expect(detectCurrentKnowledgeIntent("上海今天日出日落时间")).toBeNull();
    expect(detectCurrentKnowledgeIntent("今天有什么新闻")).toBeNull();
  });
});

describe("createCurrentKnowledgeProvider", () => {
  it("uses Open-Meteo geocoding and forecast APIs for weather", async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const href = String(url);
      if (href.includes("geocoding-api.open-meteo.com")) {
        return jsonResponse({
          results: [
            {
              name: "Beijing",
              country: "China",
              latitude: 39.9042,
              longitude: 116.4074,
              timezone: "Asia/Shanghai"
            }
          ]
        });
      }

      if (href.includes("api.open-meteo.com")) {
        return jsonResponse({
          current: {
            temperature_2m: 23.5,
            apparent_temperature: 22.8,
            relative_humidity_2m: 45,
            precipitation: 0,
            weather_code: 1,
            wind_speed_10m: 8.2
          },
          daily: {
            temperature_2m_max: [27.1],
            temperature_2m_min: [16.4],
            precipitation_sum: [0.2],
            sunrise: ["2026-05-23T04:53"],
            sunset: ["2026-05-23T19:30"]
          }
        });
      }

      throw new Error(`unexpected url: ${href}`);
    });

    const provider = createCurrentKnowledgeProvider({
      fetch: fetchImpl,
      now: () => new Date("2026-05-23T10:00:00.000+08:00")
    });

    const context = await provider.retrieve({ userText: "查一下北京今天的天气", userTranscript: "" });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(context).toMatchObject({
      kind: "weather",
      title: "Beijing, China 天气",
      source: "Open-Meteo"
    });
    expect(context?.summary).toContain("23.5");
    expect(formatCurrentKnowledgeContext(context)).toContain("本地实时工具结果");
    expect(formatCurrentKnowledgeContext(context)).toContain("Open-Meteo");
  });

  it("does not call removed fixed-output APIs", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("removed APIs should not be called");
    });
    const provider = createCurrentKnowledgeProvider({ fetch: fetchImpl });

    await expect(provider.retrieve({ userText: "历史上的今天发生了什么", userTranscript: "" })).resolves.toBeNull();
    await expect(provider.retrieve({ userText: "美元兑人民币汇率是多少", userTranscript: "" })).resolves.toBeNull();
    await expect(provider.retrieve({ userText: "今年中国节假日", userTranscript: "" })).resolves.toBeNull();
    await expect(provider.retrieve({ userText: "上海今天日出日落时间", userTranscript: "" })).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: {
      "content-type": "application/json"
    }
  });
}
