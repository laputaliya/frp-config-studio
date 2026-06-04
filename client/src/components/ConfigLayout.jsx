import React from 'react';

export default function ConfigLayout({ left, right }) {
  return (
    <div className="row">
      <div className="col-lg-7 mb-3 mb-lg-0">
        {left}
      </div>
      <div className="col-lg-5">
        {right}
      </div>
    </div>
  );
}
