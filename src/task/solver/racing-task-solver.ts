import {Fix} from "../../read-flight";
import Task from "../task";
import Point from "../../geo/point";
import AreaShape from "../shapes/area";
import {Event, FinishEvent, StartEvent, TurnEvent} from "../events";

interface TaskFix {
  time: number;
  point: Point;
}

export default class RacingTaskSolver {
  task: Task;

  events: Event[] = [];

  private _lastFix: Fix | undefined = undefined;
  private _maxDistance = 0;
  private _maxDistanceFix: TaskFix | undefined;

  constructor(task: Task) {
    this.task = task;
  }

  get taskStarted(): boolean {
    return this.events.some(event => event instanceof StartEvent);
  }

  get taskFinished(): boolean {
    return this.events.some(event => event instanceof FinishEvent);
  }

  consume(fixes: Fix[]) {
    fixes.forEach(fix => this.update(fix));
  }

  update(fix: Fix) {
    if (this._lastFix) {
      this._update(fix, this._lastFix);
    }
    this._lastFix = fix;
  }

  _update(fix: Fix, lastFix: Fix) {
    let start = this.task.checkStart(lastFix, fix);
    if (start) {
      this.events.push(new StartEvent(fix));
    }

    for (let i = 1; i < this.task.points.length - 1; i++) {
      let prevTPReached = this.events.some(i === 1 ?
        (event => event instanceof StartEvent) :
        (event => event instanceof TurnEvent && event.num === i - 1));

      if (prevTPReached) {
        // SC3a §6.3.1b
        //
        // A Turn Point is achieved by entering that Turn Point's Observation Zone.

        let tp = this.task.points[i];
        if (tp.shape instanceof AreaShape && !tp.shape.isInside(lastFix.coordinate) && tp.shape.isInside(fix.coordinate)) {
          this.events.push(new TurnEvent(fix, i));
        }
      }
    }

    let lastTPReached = this.events.some(event => event instanceof TurnEvent && event.num === this.task.points.length - 2);
    if (lastTPReached) {
      let finish = this.task.checkFinish(lastFix, fix);
      if (finish) {
        this.events.push(new FinishEvent(fix));
      }
    }

    if (this.taskFinished || !this.taskStarted) {
      return;
    }

    let legIndex = Math.max(0, ...this.events.map(event => (event instanceof TurnEvent) ? event.num : 0));

    let nextTP = this.task.points[legIndex + 1];

    // SC3a §6.3.1d (ii)
    //
    // If the competitor has outlanded on the last leg, the Marking Distance is
    // the distance from the Start Point, less the radius of the Start Ring (if
    // used), through each Turn Point to the Finish point, less the distance from
    // the Outlanding Position to the Finish Point. If the achieved distance on
    // the last leg is less than zero, it shall be taken as zero.

    // SC3a §6.3.1d (iii)
    //
    // If the competitor has outlanded on any other leg, the Marking Distance
    // is the distance from the Start Point, less the radius of the Start Ring (if
    // used), through each Turn Point achieved plus the distance achieved on
    // the uncompleted leg. The achieved distance of the uncompleted leg is the
    // length of that leg less the distance between the Outlanding Position and
    // the next Turn Point. If the achieved distance of the uncompleted leg is
    // less than zero, it shall be taken as zero.

    let finishedLegs = this.task.legs.slice(0, legIndex);
    let finishedLegsDistance = finishedLegs.reduce((sum, leg) => sum + leg.distance, 0);
    let currentLegDistance = this.task.legs[legIndex].distance - this.task.measureDistance(fix.coordinate, nextTP.shape.center) * 1000;
    let maxDistance = finishedLegsDistance + currentLegDistance;
    if (maxDistance > this._maxDistance) {
      this._maxDistance = maxDistance;
      this._maxDistanceFix = { time: fix.time, point: fix.coordinate };
    }
  }

  get result(): any {
    // SC3a §6.3.1b
    //
    // The task is completed when the competitor makes a valid Start, achieves
    // each Turn Point in the designated sequence, and makes a valid Finish.

    // FinishEvent is only added when last TP has been reached which simplifies the check here
    let completed = this.events.some(event => event instanceof FinishEvent);

    // SC3a §6.3.1d (i)
    //
    // For a completed task, the Marking Distance is the Task Distance.

    let distance = completed ? this.task.distance : this._maxDistance;

    // SC3a §6.3.1d (iv)
    //
    // For finishers, the Marking Time is the time elapsed between the most
    // favorable valid Start Time and the Finish Time. For non-finishers the
    // Marking Time is undefined.

    let path = this.events
      .filter(event => event instanceof StartEvent)
      .map(event => pathForStart(event, this.events))
      .sort(sortEventPaths)
      .shift()!;

    let time = path.time;

    // SC3a §6.3.1d (v)
    //
    // For finishers, the Marking Speed is the Marking Distance divided by the
    // Marking Time. For non-finishers the Marking Speed is zero.

    let speed = completed ? (distance as number / 1000) / (time as number / 3600) : undefined;

    return {
      path: path.path,
      completed,
      time,
      distance,
      speed,
    }
  }
}

export function pathForStart(start: StartEvent, events: Event[]): EventPath {
  let path: Event[] = [start];
  let time;

  for (let i = events.indexOf(start) + 1; i < events.length; i++) {
    let event = events[i];
    if (event instanceof TurnEvent && event.num === path.length) {
      path.push(event);
    } else if (event instanceof FinishEvent) {
      path.push(event);
      time = (event.time - start.time) / 1000;
    }
  }

  return { path, time };
}

interface EventPath {
  path: Event[];
  time: number | undefined;
}

function sortEventPaths(a: EventPath, b: EventPath) {
  if (a.time !== undefined && b.time !== undefined)
    return a.time - b.time;

  if (a.time !== undefined && b.time === undefined)
    return -1;

  if (a.time === undefined && b.time !== undefined)
    return 1;

  return b.path.length - a.path.length;
}
