class ServiceError(Exception):
    def __init__(self, message: str, *, status: int = 422, code: str = "processing_failed"):
        super().__init__(message)
        self.status = status
        self.code = code


class YouTubeBlocked(ServiceError):
    def __init__(self):
        super().__init__(
            "O YouTube bloqueou a extração ou exige autenticação. Faça upload do arquivo de áudio diretamente na análise local da PWA.",
            code="youtube_blocked",
        )
