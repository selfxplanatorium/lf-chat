import { Router, Response } from 'express';
import { generationManager } from '../generation/manager';
import { getCounters } from '../generation/log';
import { eventBus } from '../generation/eventBus';
import { getAllSnapshotStates, getSnapshotState } from '../generation/snapshot';

const router = Router();

router.get('/generations', (_req, res: Response) => {
  res.json({
    active: generationManager.getAllActive(),
    counters: getCounters(),
    subscribers: eventBus.getAllSubscriberCounts(),
    snapshots: getAllSnapshotStates(),
  });
});

router.get('/generations/:convId/snapshot', (req, res: Response) => {
  const state = getSnapshotState(req.params.convId);
  if (!state) {
    res.json({ error: 'No snapshot state for this conversation' });
    return;
  }
  res.json(state);
});

export default router;