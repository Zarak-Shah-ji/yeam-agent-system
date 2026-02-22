import { GoogleGenerativeAI } from '@google/generative-ai'

export const GEMINI_AVAILABLE = !!process.env.GEMINI_API_KEY

let _genAI: GoogleGenerativeAI | null = null

function getGenAI(): GoogleGenerativeAI {
  if (!_genAI) _genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
  return _genAI
}

export function getModel(systemInstruction: string) {
  return getGenAI().getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction,
  })
}
