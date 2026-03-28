import type { PermissionRequest } from '../store';

export default function PermissionDialog({ request }: { request: PermissionRequest }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-xs w-full p-5">
        <div className="text-center mb-4">
          <div className="w-10 h-10 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-3">
            <svg className="w-5 h-5 text-yellow-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          </div>
          <h3 className="text-sm font-semibold text-gray-900">Permission Required</h3>
        </div>

        <div className="space-y-2 mb-5 text-xs text-gray-600">
          <p>
            <span className="font-medium text-gray-700">Tool:</span> {request.toolName}
          </p>
          <p>
            <span className="font-medium text-gray-700">Action:</span> {request.permissionType}
          </p>
          <p>
            <span className="font-medium text-gray-700">Domain:</span>{' '}
            <span className="font-mono bg-gray-100 px-1.5 py-0.5 rounded">{request.domain || 'unknown'}</span>
          </p>
        </div>

        <div className="space-y-2">
          <button
            onClick={() => request.resolve(true, 'always')}
            className="w-full py-2 bg-orange-600 text-white rounded-lg text-xs font-medium hover:bg-orange-700 transition-colors"
          >
            Allow Always
          </button>
          <button
            onClick={() => request.resolve(true, 'once')}
            className="w-full py-2 bg-gray-100 text-gray-700 rounded-lg text-xs font-medium hover:bg-gray-200 transition-colors"
          >
            Allow Once
          </button>
          <button
            onClick={() => request.resolve(false, 'once')}
            className="w-full py-2 text-red-600 rounded-lg text-xs font-medium hover:bg-red-50 transition-colors"
          >
            Deny
          </button>
        </div>
      </div>
    </div>
  );
}
