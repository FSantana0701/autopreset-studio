class ServiceError(Exception):
    def __init__(self, message: str, *, status: int = 422, code: str = "processing_failed"):
        super().__init__(message)
        self.status = status
        self.code = code


class YouTubeBlocked(ServiceError):
    def __init__(self):
        super().__init__(
            "DOWNLOAD_BLOCKED",
            code="DOWNLOAD_BLOCKED",
        )
