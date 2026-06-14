from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import PlainTextResponse
from sqlalchemy.orm import Session

from ..db import get_db
from ..events_bus import publish_event
from ..models import Task, TaskReport
from ..reporting import evaluate_task_intelligence, persist_task_report, task_report_to_dict

router = APIRouter(prefix="/api/reports", tags=["reports"])


@router.get("")
def list_reports(
    task_id: int | None = None,
    limit: int = Query(20, ge=1, le=200),
    db: Session = Depends(get_db),
):
    qs = db.query(TaskReport)
    if task_id is not None:
        qs = qs.filter(TaskReport.task_id == task_id)
    rows = qs.order_by(TaskReport.created_at.desc(), TaskReport.id.desc()).limit(limit).all()
    return {"items": [task_report_to_dict(row, include_body=False) for row in rows]}


@router.get("/{report_id}")
def get_report(report_id: int, db: Session = Depends(get_db)):
    row = db.query(TaskReport).filter(TaskReport.id == report_id).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Report not found")
    return task_report_to_dict(row, include_body=True)


@router.get("/{report_id}/download")
def download_report(report_id: int, db: Session = Depends(get_db)):
    row = db.query(TaskReport).filter(TaskReport.id == report_id).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Report not found")
    filename = f"task-report-{row.task_id}-{row.id}.md"
    headers = {"Content-Disposition": f'attachment; filename="{filename}"'}
    return PlainTextResponse(row.report_markdown, headers=headers, media_type="text/markdown")


@router.post("/generate/task/{task_id}")
async def generate_report_for_task(task_id: int, db: Session = Depends(get_db)):
    task = db.query(Task).filter(Task.id == task_id).first()
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")

    evaluation = evaluate_task_intelligence(db, task)
    report = persist_task_report(db, task, evaluation)
    await publish_event(
        "task.report.generated",
        "INFO",
        "api",
        {
            "task_id": task.id,
            "report_id": report.id,
            "threat_detected": evaluation["threat_detected"],
            "threat_risk": evaluation["threat_risk"],
            "summary": evaluation["summary"],
        },
        score=evaluation["alert_score"],
    )
    if evaluation["should_alert"]:
        await publish_event(
            "task.alert",
            "WARN" if evaluation["threat_detected"] else "INFO",
            "api",
            {**evaluation["alert"], "report_id": report.id},
            score=evaluation["alert_score"],
        )
    return task_report_to_dict(report, include_body=True)
