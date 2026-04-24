import { clerkClient, currentUser } from "@clerk/nextjs/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import dedent from "dedent";
import { AzureOpenAI } from "openai";
import { z } from "zod";

let ratelimit: Ratelimit | undefined;

export async function POST(req: Request) {
  const user = await currentUser();

  if (!user) {
    return new Response("", { status: 404 });
  }

  const json = await req.json();
  const data = z
    .object({
      userAPIKey: z.string().optional(),
      companyName: z.string(),
      selectedStyle: z.string(),
      selectedPrimaryColor: z.string(),
      selectedBackgroundColor: z.string(),
      additionalInfo: z.string().optional(),
    })
    .parse(json);

  if (process.env.UPSTASH_REDIS_REST_URL && !data.userAPIKey) {
    ratelimit = new Ratelimit({
      redis: Redis.fromEnv(),
      limiter: Ratelimit.fixedWindow(999, "60 d"),
      analytics: true,
      prefix: "logocreator",
    });
  }

  const client = new AzureOpenAI({
    endpoint: process.env.AZURE_OPENAI_ENDPOINT!,
    apiKey: data.userAPIKey || process.env.AZURE_OPENAI_API_KEY!,
    apiVersion: "2024-02-15-preview",
  });

  if (data.userAPIKey) {
    (await clerkClient()).users.updateUserMetadata(user.id, {
      unsafeMetadata: {
        remaining: "BYOK",
      },
    });
  }

  if (ratelimit) {
    const identifier = user.id;
    const { success, remaining } = await ratelimit.limit(identifier);
    (await clerkClient()).users.updateUserMetadata(user.id, {
      unsafeMetadata: {
        remaining,
      },
    });

    if (!success) {
      return new Response(
        "You've used up all your credits. Enter your own API Key to generate more logos.",
        {
          status: 429,
          headers: { "Content-Type": "text/plain" },
        },
      );
    }
  }

  const flashyStyle =
    "Flashy, attention grabbing, bold, futuristic, and eye-catching. Use vibrant neon colors with metallic, shiny, and glossy accents.";

  const techStyle =
    "highly detailed, sharp focus, cinematic, photorealistic, Minimalist, clean, sleek, neutral color pallete with subtle accents, clean lines, shadows, and flat.";

  const modernStyle =
    "modern, forward-thinking, flat design, geometric shapes, clean lines, natural colors with subtle accents, use strategic negative space to create visual interest.";

  const playfulStyle =
    "playful, lighthearted, bright bold colors, rounded shapes, lively.";

  const abstractStyle =
    "abstract, artistic, creative, unique shapes, patterns, and textures to create a visually interesting and wild logo.";

  const minimalStyle =
    "minimal, simple, timeless, versatile, single color logo, use negative space, flat design with minimal details, Light, soft, and subtle.";

  const styleLookup: Record<string, string> = {
    Flashy: flashyStyle,
    Tech: techStyle,
    Modern: modernStyle,
    Playful: playfulStyle,
    Abstract: abstractStyle,
    Minimal: minimalStyle,
  };

  // プロンプトの文字列をオリジナルのコードと全く同じ状態に復元しました
  const prompt = dedent`A single logo, high-quality, award-winning professional design, made for both digital and print media, only contains a few vector shapes, ${styleLookup[data.selectedStyle]}

  Primary color is ${data.selectedPrimaryColor.toLowerCase()} and background color is ${data.selectedBackgroundColor.toLowerCase()}. The company name is ${data.companyName}, make sure to include the company name in the logo. ${data.additionalInfo ? `Additional info: ${data.additionalInfo}` : ""}`;

  try {
    const response = await client.images.generate({
      prompt,
      model: "gpt-image-2",
      n: 1,
      size: "1024x1024",
      response_format: "b64_json",
    });
    
    return Response.json(response.data[0], { status: 200 });
 } catch (error: any) {
    if (error?.status === 401) {
      return new Response("Your API key is invalid.", {
        status: 401,
        headers: { "Content-Type": "text/plain" },
      });
    }

    if (error?.code === "content_policy_violation" || error?.status === 400) {
      return new Response(
        "Your request was blocked by Azure OpenAI's content filter. Please try a different prompt.",
        {
          status: 400,
          headers: { "Content-Type": "text/plain" },
        },
      );
    }

    // 🚨 調査用：エラーの正体をそのまま画面に返すように変更！
    return new Response(
      `詳細エラー: ${error?.message || error?.toString() || "不明なエラー"}`,
      {
        status: 500,
        headers: { "Content-Type": "text/plain" },
      }
    );
  }
}

export const runtime = "edge";
