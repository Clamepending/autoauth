import type { PlanRequest } from '../store';

export default function PlanView({ request }: { request: PlanRequest }) {
  const { plan } = request;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-5 max-h-[80vh] overflow-y-auto">
        <h3 className="text-sm font-semibold text-gray-900 mb-3">Proposed Plan</h3>

        {plan.domains.length > 0 && (
          <div className="mb-3">
            <p className="text-xs font-medium text-gray-500 mb-1.5">Sites to visit:</p>
            <div className="flex flex-wrap gap-1">
              {plan.domains.map((d, i) => (
                <span
                  key={i}
                  className="px-2 py-0.5 bg-blue-50 text-blue-700 text-xs rounded-md font-mono"
                >
                  {d}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="mb-5">
          <p className="text-xs font-medium text-gray-500 mb-1.5">Steps:</p>
          <ol className="space-y-1.5">
            {plan.approach.map((step, i) => (
              <li key={i} className="flex gap-2 text-xs text-gray-700">
                <span className="text-gray-400 font-mono flex-shrink-0">{i + 1}.</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => request.resolve(true)}
            className="flex-1 py-2 bg-orange-600 text-white rounded-lg text-xs font-medium hover:bg-orange-700 transition-colors"
          >
            Approve
          </button>
          <button
            onClick={() => request.resolve(false)}
            className="flex-1 py-2 bg-gray-100 text-gray-700 rounded-lg text-xs font-medium hover:bg-gray-200 transition-colors"
          >
            Reject
          </button>
        </div>
      </div>
    </div>
  );
}
