using Dapper;
using ordermateAPI.DAL.Interfaces;
using ordermateAPI.DAL.Models;
using ordermateAPI.DAL.Scripts;

namespace ordermateAPI.DAL.Repositories;

public class OrderItemModifierRepository : IOrderItemModifierRepository
{
    private readonly IDbContext _dbContext;

    public OrderItemModifierRepository(IDbContext dbContext)
    {
        _dbContext = dbContext;
    }
    
    public async Task<IEnumerable<OrderItemModifierModel>> GetAllByOrderItemId(int orderItemId)
    {
        using var connection = _dbContext.CreateConnection();
        return await connection.QueryAsync<OrderItemModifierModel>(OrderItemModifierScripts.GetAllByOrderItem, new { orderItemId });
    }
    
    public async Task<IEnumerable<OrderItemModifierModel>> GetAllByOrderId(int orderId)
    {
        using var connection = _dbContext.CreateConnection();
        return await connection.QueryAsync<OrderItemModifierModel>(OrderItemModifierScripts.GetAllByOrderItem, new { orderId });
    }
}