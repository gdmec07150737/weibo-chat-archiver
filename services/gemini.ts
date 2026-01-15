
import { GoogleGenAI, Type } from "@google/genai";
import { WeiboMessage } from "../types";

export const parseRawChatData = async (rawText: string): Promise<WeiboMessage[]> => {
  // Always instantiate GoogleGenAI right before use to ensure it has the most current API key from the environment.
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `你是一个专业的微博数据解析专家。请解析提供的原始 JSON 或文本数据。
    
    微博消息结构的特征通常如下：
    - 消息内容在 'text' 或 'content' 字段。
    - 时间在 'created_at' (格式如 "Thu Jan 15 22:16:32 +0800 2026")。
    - 发送者信息在 'user' 对象中，包含 'screen_name' 和 'idstr'。
    
    请输出严格的 JSON 数组，包含：id, senderName, senderId, content, timestamp (ISO格式), avatar。
    
    数据内容：
    ${rawText.substring(0, 20000)} // 截取防止超长`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            id: { type: Type.STRING },
            senderName: { type: Type.STRING },
            senderId: { type: Type.STRING },
            content: { type: Type.STRING },
            timestamp: { type: Type.STRING },
            avatar: { type: Type.STRING }
          },
          required: ["id", "senderName", "content", "timestamp"]
        }
      }
    }
  });

  try {
    // Access the .text property directly (not a method call) as per the latest SDK specifications.
    const text = response.text;
    if (!text) {
      return [];
    }
    return JSON.parse(text.trim());
  } catch (error) {
    console.error("AI解析失败:", error);
    return [];
  }
};
