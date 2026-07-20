import React from 'react'

/**
 * Centered layout wrapper for authentication pages (sign-in).
 */
const AuthLayout = ({ children }: { children: React.ReactNode }) => {
  return (
    <section className='flex flex-col h-screen items-center justify-center  '>
        <div className='max-w-md sm:mx-auto'>
            {children}
        </div>
    </section>
  )
}


export default AuthLayout   
  