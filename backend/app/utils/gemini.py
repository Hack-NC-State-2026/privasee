"""Gemini LLM utility."""

import google.generativeai as genai


class GeminiClient:
    """Client for Gemini API. Takes a prompt and returns the model response."""

    def __init__(self, api_key: str, *, model: str = "gemini-1.5-flash") -> None:
        genai.configure(api_key=api_key)
        self._model = genai.GenerativeModel(model)

    def generate(self, prompt: str) -> str:
        """Send the prompt to Gemini and return the generated text."""
        response = self._model.generate_content(prompt)
        return response.text
