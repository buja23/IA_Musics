"""
Trap AI Studio — Gerenciador de Jobs e Conexões WebSocket
==========================================================
Gerencia o ciclo de vida dos jobs de processamento de áudio em memória
e transmite atualizações de progresso em tempo real via WebSockets.

Suporta chamadas tanto de corrotinas assíncronas quanto de threads
síncronas (via asyncio.run_coroutine_threadsafe).
"""

from __future__ import annotations

import asyncio
import datetime
import logging
from typing import Any
from fastapi import WebSocket, WebSocketDisconnect

logger = logging.getLogger("trap_ai_studio.job_manager")


class JobManager:
    """
    Gerenciador singleton em memória para status de jobs e WebSockets.
    """

    def __init__(self) -> None:
        self.jobs: dict[str, dict[str, Any]] = {}
        self.connections: dict[str, set[WebSocket]] = {}
        self._loop: asyncio.AbstractEventLoop | None = None

    def set_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        """Registra o event loop principal da aplicação FastAPI."""
        self._loop = loop

    def get_loop(self) -> asyncio.AbstractEventLoop:
        """Retorna o event loop registrado ou obtém o loop corrente."""
        if self._loop and self._loop.is_running():
            return self._loop
        try:
            return asyncio.get_running_loop()
        except RuntimeError:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            self._loop = loop
            return loop

    def create_job(
        self,
        job_id: str,
        initial_stage: str = "upload",
        initial_progress: float = 10.0,
        initial_message: str = "Arquivo recebido. Preparando pipeline de IA...",
    ) -> dict[str, Any]:
        """Inicializa um novo job no gerenciador."""
        now = datetime.datetime.now(datetime.timezone.utc).isoformat()
        job_data = {
            "job_id": job_id,
            "status": "processing",
            "progress": initial_progress,
            "stage": initial_stage,
            "message": initial_message,
            "result": None,
            "error": None,
            "created_at": now,
            "updated_at": now,
        }
        self.jobs[job_id] = job_data
        if job_id not in self.connections:
            self.connections[job_id] = set()
        logger.info("Job registrado: %s (%s)", job_id, initial_stage)
        return job_data

    def get_job(self, job_id: str) -> dict[str, Any] | None:
        """Retorna os dados atuais do job, se existir."""
        return self.jobs.get(job_id)

    async def connect(self, job_id: str, websocket: WebSocket) -> None:
        """
        Aceita uma conexão WebSocket para um job específico e envia
        imediatamente o estado atual do job.
        """
        await websocket.accept()
        if job_id not in self.connections:
            self.connections[job_id] = set()
        self.connections[job_id].add(websocket)
        logger.info(
            "WebSocket conectado para job_id=%s (Total: %d)",
            job_id,
            len(self.connections[job_id]),
        )

        # Enviar estado mais recente imediatamente para o cliente recém-conectado
        job = self.get_job(job_id)
        if job:
            try:
                await websocket.send_json(job)
            except Exception as exc:
                logger.warning("Falha ao enviar estado inicial ao WebSocket: %s", exc)

    def disconnect(self, job_id: str, websocket: WebSocket) -> None:
        """Remove o WebSocket desconectado."""
        if job_id in self.connections:
            self.connections[job_id].discard(websocket)
            logger.info(
                "WebSocket desconectado de job_id=%s (Restantes: %d)",
                job_id,
                len(self.connections[job_id]),
            )
            if not self.connections[job_id]:
                del self.connections[job_id]

    async def broadcast_progress_async(
        self,
        job_id: str,
        progress: float,
        stage: str,
        message: str,
        result: dict[str, Any] | None = None,
        error: str | None = None,
    ) -> None:
        """
        Atualiza o estado em memória e transmite via WebSocket de forma assíncrona.
        """
        now = datetime.datetime.now(datetime.timezone.utc).isoformat()
        status = "failed" if error else ("completed" if progress >= 100 else "processing")

        if job_id not in self.jobs:
            self.create_job(job_id, stage, progress, message)

        job = self.jobs[job_id]
        job["progress"] = round(float(progress), 1)
        job["stage"] = stage
        job["message"] = message
        job["status"] = status
        job["updated_at"] = now
        if result is not None:
            job["result"] = result
        if error is not None:
            job["error"] = error

        logger.info(
            "[%s] %s%% | stage=%s | %s",
            job_id,
            job["progress"],
            stage,
            message,
        )

        # Transmissão aos clientes conectados
        active_sockets = list(self.connections.get(job_id, set()))
        dead_sockets: list[WebSocket] = []

        for ws in active_sockets:
            try:
                await ws.send_json(job)
            except (WebSocketDisconnect, RuntimeError):
                dead_sockets.append(ws)
            except Exception as exc:
                logger.warning("Erro ao enviar WebSocket para %s: %s", job_id, exc)
                dead_sockets.append(ws)

        for dead in dead_sockets:
            self.disconnect(job_id, dead)

    def broadcast_progress(
        self,
        job_id: str,
        progress: float,
        stage: str,
        message: str,
        result: dict[str, Any] | None = None,
        error: str | None = None,
    ) -> None:
        """
        Ponto de entrada síncrono / thread-safe para atualizar e transmitir progresso.
        Pode ser chamado de dentro de threads do pool (asyncio.to_thread).
        """
        loop = self.get_loop()
        coro = self.broadcast_progress_async(
            job_id=job_id,
            progress=progress,
            stage=stage,
            message=message,
            result=result,
            error=error,
        )

        try:
            current_loop = asyncio.get_running_loop()
            if current_loop is loop:
                # Já estamos no loop principal
                asyncio.create_task(coro)
            else:
                # Chamado de outro loop
                asyncio.run_coroutine_threadsafe(coro, loop)
        except RuntimeError:
            # Sem loop rodando na thread atual (ex: worker thread)
            if loop and loop.is_running():
                asyncio.run_coroutine_threadsafe(coro, loop)
            else:
                # Fallback síncrono para atualizar dados se não houver loop rodando
                now = datetime.datetime.now(datetime.timezone.utc).isoformat()
                status = "failed" if error else ("completed" if progress >= 100 else "processing")
                if job_id not in self.jobs:
                    self.create_job(job_id, stage, progress, message)
                j = self.jobs[job_id]
                j["progress"] = round(float(progress), 1)
                j["stage"] = stage
                j["message"] = message
                j["status"] = status
                j["updated_at"] = now
                if result is not None:
                    j["result"] = result
                if error is not None:
                    j["error"] = error


# Instância global singleton
job_manager = JobManager()
